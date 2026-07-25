import { deserializeMdNote, ensureMarkdownElement, getSceneBounds, type Note } from "@notegpt/core";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";

const PRINT_READY_TIMEOUT_MS = 5000;
const FALLBACK_WINDOW_HEIGHT = 800;
// Padding (px) around the scene's content bounds — matches PrintView.tsx's own
// CONTENT_PADDING, so the print window's width is sized to exactly what PrintView
// will actually render.
const CONTENT_PADDING = 40;
// Chromium's print pipeline lays out HTML at the window's actual CSS pixel width and, by
// default, does not reliably shrink content wider than the physical page to fit it — it
// clips instead. Rather than fight a fixed A4 width against our (sometimes wider) annotation
// canvas, make the PDF page exactly as wide as the content (at the standard 96 CSS px/in),
// with zero side margins, so nothing needs to be scaled and nothing can be clipped
// horizontally. Page height stays a fixed, tall value so tall notes still paginate normally.
const CSS_PX_PER_INCH = 96;
const PAGE_HEIGHT_INCHES = 11.69; // A4 height

/**
 * The print width is sized to exactly fit the scene's own content bounds — the markdown
 * column plus however far any hand-drawn annotation extends left/right of it. Both live
 * in the same scene-coordinate space (the markdown container is a real scene element, see
 * `ensureMarkdownElement`), so this is a direct measurement, not a scrollX/zoom/viewport
 * approximation.
 */
function getPrintWidth(note: Note): number {
  const elements = ensureMarkdownElement(note.annotation.elements);
  const { minX, maxX } = getSceneBounds(elements);
  return Math.ceil(maxX - minX) + CONTENT_PADDING * 2;
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

        const [, mainHeight] = win?.getContentSize() ?? [0, FALLBACK_WINDOW_HEIGHT];
        const note = deserializeMdNote(await fs.readFile(filePath, "utf-8"));
        const printWidth = getPrintWidth(note);
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
