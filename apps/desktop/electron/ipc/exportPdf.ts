import { deserializeMdNote, type Note } from "@notegpt/core";
import { BrowserWindow, dialog, ipcMain, screen } from "electron";
import { promises as fs } from "node:fs";

const PRINT_READY_TIMEOUT_MS = 5000;
// Matches .notegpt-sidebar's width in styles.css.
const SIDEBAR_WIDTH = 260;
// Matches .notegpt-markdown-content-inner's max-width in styles.css — the text column.
const TEXT_COLUMN_WIDTH = 900;
const FALLBACK_PRINT_SIZE = { width: 1200 - SIDEBAR_WIDTH, height: 800 };
// Chromium's print pipeline lays out HTML at the window's actual CSS pixel width and, by
// default, does not reliably shrink content wider than the physical page to fit it — it
// clips instead. Rather than fight a fixed A4 width against our (sometimes wider) annotation
// canvas, make the PDF page exactly as wide as the content (at the standard 96 CSS px/in),
// with zero side margins, so nothing needs to be scaled and nothing can be clipped
// horizontally. Page height stays a fixed, tall value so tall notes still paginate normally.
const CSS_PX_PER_INCH = 96;
const PAGE_HEIGHT_INCHES = 11.69; // A4 height

interface ExcalidrawElementLike {
  x?: number;
  width?: number;
  isDeleted?: boolean;
}

/**
 * Detects whether any annotation extends into the margins beside the centered text column
 * (as opposed to sitting entirely under it).
 *
 * Elements store x/width in scene coordinates, independent of viewport size — but "does this
 * sit under the text column" also depends on where that column sat on screen, which depends
 * on the pane width *at draw time* (the column is centered within it) and the saved
 * scrollX/zoom transform. `paneWidth`, persisted on the scene, gives us that; `fallbackWidth`
 * (the current window's width) only covers notes saved before that field existed.
 */
function hasMarginAnnotation(note: Note, fallbackWidth: number): boolean {
  const annotation = note.annotation as { paneWidth?: number; appState?: Record<string, unknown>; elements?: unknown[] };
  const referenceWidth = FALLBACK_PRINT_SIZE.width;

  const appState = (annotation.appState ?? {}) as { scrollX?: unknown; zoom?: { value?: unknown } };
  const scrollX = typeof appState.scrollX === "number" ? appState.scrollX : 0;
  const zoom = typeof appState.zoom?.value === "number" ? appState.zoom.value : 1;

  const marginLeft = Math.max(0, (referenceWidth - TEXT_COLUMN_WIDTH) / 2);
  const columnRight = marginLeft + Math.min(TEXT_COLUMN_WIDTH, referenceWidth);
  const CLEARANCE = 1; // px slack against floating-point/measurement noise
  const elements = (annotation.elements ?? []) as ExcalidrawElementLike[];
  return elements.some((el) => {
    if (el.isDeleted) return false;
    const x = typeof el.x === "number" ? el.x : 0;
    const width = typeof el.width === "number" ? el.width : 0;
    const screenMinX = (x - scrollX) * zoom;
    const screenMaxX = (x + width - scrollX) * zoom;
    return screenMinX < marginLeft - CLEARANCE || screenMaxX > columnRight + CLEARANCE;
  });
}

export interface ExportPdfOptions {
  isDev: boolean;
  preloadPath: string;
  rendererDevUrl: string | undefined;
  rendererIndexPath: string;
}

function buildPrintUrl(folderPath: string, filePath: string, options: ExportPdfOptions): { devUrl?: string; query?: Record<string, string> } {
  const query = { print: "1", folder: folderPath, file: filePath };
  if (options.isDev && options.rendererDevUrl) {
    const url = new URL(options.rendererDevUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return { devUrl: url.toString() };
  }
  return { query };
}

/** Waits for the hidden print window to signal it has painted, racing a safety timeout —
 * whichever wins tears down the other so a stale listener/timer can't fire against a
 * future, unrelated export. */
function waitForPrintReady(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("mdnote:print-ready", onReady);
      resolve();
    }, PRINT_READY_TIMEOUT_MS);
    ipcMain.once("mdnote:print-ready", onReady);
  });
}

export function registerExportHandlers(getWindow: () => BrowserWindow | null, options: ExportPdfOptions): void {
  let exportInFlight = false;
  ipcMain.handle(
    "mdnote:exportNotePdf",
    async (_event, folderPath: string, filePath: string, suggestedTitle: string): Promise<string | null> => {
      if (exportInFlight) return null;
      exportInFlight = true;
      let printWin: BrowserWindow | null = null;
      try {
        const win = getWindow();
        const saveDialogOptions = {
          defaultPath: `${suggestedTitle}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        };
        const saveResult = win
          ? await dialog.showSaveDialog(win, saveDialogOptions)
          : await dialog.showSaveDialog(saveDialogOptions);
        if (saveResult.canceled || !saveResult.filePath) return null;

        const [, mainHeight] = win?.getContentSize() ?? [FALLBACK_PRINT_SIZE.width + SIDEBAR_WIDTH, FALLBACK_PRINT_SIZE.height];
        const note = deserializeMdNote(await fs.readFile(filePath, "utf-8"));
        // Whenever margins are used at all, size the export to the actual screen's width —
        // not the app window's (current or historical) width — so shrinking the app window
        // before exporting can never crop margin content back down. 
        const fullScreenWidth = screen.getPrimaryDisplay().workAreaSize.width - SIDEBAR_WIDTH ;
        const printWidth = hasMarginAnnotation(note, fullScreenWidth) ? fullScreenWidth : TEXT_COLUMN_WIDTH;
        printWin = new BrowserWindow({
          show: false,
          width: printWidth,
          height: mainHeight,
          webPreferences: {
            preload: options.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            // Excalidraw's canvas paints via requestAnimationFrame, which Chromium
            // throttles for backgrounded windows — a window that's never shown risks
            // never getting past its first paint without this.
            backgroundThrottling: false,
          },
        });

        const { devUrl, query } = buildPrintUrl(folderPath, filePath, options);
        if (devUrl) {
          await printWin.loadURL(devUrl);
        } else {
          await printWin.loadFile(options.rendererIndexPath, { query });
        }

        await waitForPrintReady();

        const pdfBuffer = await printWin.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: printWidth / CSS_PX_PER_INCH, height: PAGE_HEIGHT_INCHES },
          margins: { top: 0.4, bottom: 0.4, left: 0, right: 0 },
        });
        await fs.writeFile(saveResult.filePath, pdfBuffer);
        return saveResult.filePath;
      } finally {
        printWin?.destroy();
        exportInFlight = false;
      }
    }
  );
}
