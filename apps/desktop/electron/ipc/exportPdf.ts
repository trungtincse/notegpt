import { deserializeMdNote, ensureMarkdownElements, getSceneBounds, isVisiblyRendered, type Note } from "@notegpt/core";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";

// Comfortably above AnnotationOverlay's own internal 3000ms readiness fallback (see its
// comments) plus margin for a couple of extra animation frames — this is the last-resort
// cap if the renderer never signals ready at all, not the timing that's expected to matter
// in practice.
const PRINT_READY_TIMEOUT_MS = 8000;
const FALLBACK_WINDOW_HEIGHT = 800;
// Padding (px) around the scene's content bounds — matches PrintView.tsx's own
// CONTENT_PADDING (keep both in sync — see its comment on why 150, not a tighter value),
// so the print window's width is sized to exactly what PrintView will actually render.
const CONTENT_PADDING = 150;
// Chromium's print pipeline lays out HTML at the window's actual CSS pixel width and, by
// default, does not reliably shrink content wider than the physical page to fit it — it
// clips instead. Rather than fight a fixed A4 width against our (sometimes wider) annotation
// canvas, make the PDF page exactly as wide (and, further down, exactly as tall) as the
// content itself (at the standard 96 CSS px/in), with zero side margins, so nothing needs
// to be scaled or clipped and the whole note always prints as a single page.
const CSS_PX_PER_INCH = 96;

/**
 * The print width is sized to exactly fit the scene's own content bounds — the markdown
 * column plus however far any hand-drawn annotation extends left/right of it. Both live
 * in the same scene-coordinate space (the markdown container is a real scene element, see
 * `ensureMarkdownElements`), so this is a direct measurement, not a scrollX/zoom/viewport
 * approximation.
 */
function getPrintWidth(note: Note): number {
  const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
  // Only visible elements count toward sizing — see PrintView.tsx's matching filter for why
  // (an invisible leftover stroke shouldn't be able to stretch the page out around nothing).
  const { minX, maxX } = getSceneBounds(elements.filter(isVisiblyRendered));
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

/** Waits for the hidden print window to signal it has painted (reporting its actual
 * rendered content height), racing a safety timeout — whichever wins tears down the
 * other so a stale listener/timer can't fire against a future, unrelated export.
 * Resolves to `null` on timeout, since there's no measured height to fall back on. */
function waitForPrintReady(): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const onReady = (_event: Electron.IpcMainEvent, contentHeight: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(contentHeight);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("mdnote:print-ready", onReady);
      resolve(null);
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

        const contentHeight = await waitForPrintReady();
        const marginTopIn = 0.4;
        const marginBottomIn = 0.4;
        // Page height matches the actual rendered content (title + scene) exactly,
        // so the whole note prints as a single page instead of paginating at a
        // fixed A4 height. Falls back to the print window's own height if the
        // renderer never reported (timed out).
        const pageHeightIn = (contentHeight ?? mainHeight) / CSS_PX_PER_INCH + marginTopIn + marginBottomIn;

        const pdfBuffer = await printWin.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: printWidth / CSS_PX_PER_INCH, height: pageHeightIn },
          margins: { top: marginTopIn, bottom: marginBottomIn, left: 0, right: 0 },
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
