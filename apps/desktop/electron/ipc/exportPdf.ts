import { deserializeMdNote, ensureMarkdownElements, getSceneBounds, isVisiblyRendered, parseNoteLink, type Note } from "@notegpt/core";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";

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

interface PrintSceneDimensions {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * The print width/height are sized to exactly fit the scene's own content bounds — the
 * markdown column plus however far any hand-drawn annotation extends around it. Both live
 * in the same scene-coordinate space (the markdown container is a real scene element, see
 * `ensureMarkdownElements`), so this is a direct measurement, not a scrollX/zoom/viewport
 * approximation. Mirrors PrintView.tsx's own `printScene` sizing exactly — the only other
 * place allowed to compute this, since link-annotation placement below depends on both
 * agreeing on the identical numbers.
 */
function getPrintSceneDimensions(note: Note): PrintSceneDimensions {
  const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
  // Only visible elements count toward sizing — see PrintView.tsx's matching filter for why
  // (an invisible leftover stroke shouldn't be able to stretch the page out around nothing).
  const { minX, minY, maxX, maxY } = getSceneBounds(elements.filter(isVisiblyRendered));
  return {
    minX,
    minY,
    width: Math.ceil(maxX - minX) + CONTENT_PADDING * 2,
    height: Math.ceil(maxY - minY) + CONTENT_PADDING * 2,
  };
}

/** Only real http(s) links are worth a clickable PDF annotation — internal note-links (see
 * buildNoteLink) point at another .mdnote file, which a PDF viewer has no way to open. */
function isExternalLink(link: unknown): link is string {
  return typeof link === "string" && /^https?:\/\//.test(link) && parseNoteLink(link) === null;
}

interface LinkRect {
  url: string;
  /** Pixel position/size within the print page's content box (title + scene), i.e. the same
   * coordinate space `.notegpt-print-page`'s bounding rect is measured in — NOT scene space,
   * and not yet converted to PDF points or flipped to PDF's bottom-left origin. */
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
}

/** Maps each linked element's scene bounding box to its pixel rect in the print page, using
 * the exact same scrollX/scrollY = -min + CONTENT_PADDING, zoom = 1 math PrintView.tsx's
 * `printScene.scene.appState` sets up — this function and that one must never drift apart. */
function collectLinkRects(note: Note, titleBlockHeightPx: number): LinkRect[] {
  const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
  const { minX, minY } = getSceneBounds(elements.filter(isVisiblyRendered));

  const rects: LinkRect[] = [];
  for (const el of elements as Array<{ isDeleted?: unknown; link?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown }>) {
    if (el.isDeleted || !isExternalLink(el.link)) continue;
    const x = typeof el.x === "number" ? el.x : 0;
    const y = typeof el.y === "number" ? el.y : 0;
    const width = typeof el.width === "number" ? el.width : 0;
    const height = typeof el.height === "number" ? el.height : 0;
    rects.push({
      url: el.link,
      xPx: x - minX + CONTENT_PADDING,
      yPx: y - minY + CONTENT_PADDING + titleBlockHeightPx,
      widthPx: width,
      heightPx: height,
    });
  }
  return rects;
}

const POINTS_PER_CSS_PX = 72 / CSS_PX_PER_INCH;

/** Adds a clickable PDF Link annotation for each rect — pdf-lib has no first-class API for
 * this, so the annotation dict is built by hand via its low-level PDFContext (the standard
 * recipe for this; see pdf-lib's own issue tracker for prior art). `context.obj()` turns a
 * bare JS string into a PDF *Name* (correct for /Type, /Subtype, /S — those are names per the
 * PDF spec), which is why the URI itself has to be wrapped in `PDFString.of()` explicitly
 * instead of being left as a plain string in the literal. */
async function addLinkAnnotations(pdfBytes: Uint8Array, links: LinkRect[], marginTopIn: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPage(0);
  const pageHeightPt = page.getHeight();
  const marginTopPt = marginTopIn * 72;

  for (const link of links) {
    const xPt = link.xPx * POINTS_PER_CSS_PX;
    const topYPt = pageHeightPt - marginTopPt - link.yPx * POINTS_PER_CSS_PX;
    const bottomYPt = topYPt - link.heightPx * POINTS_PER_CSS_PX;
    const widthPt = link.widthPx * POINTS_PER_CSS_PX;

    const annotation = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [xPt, bottomYPt, xPt + widthPt, topYPt],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(link.url),
      },
    });
    const annotationRef = pdfDoc.context.register(annotation);
    const existingAnnots = page.node.Annots();
    if (existingAnnots) {
      existingAnnots.push(annotationRef);
    } else {
      page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([annotationRef]));
    }
  }

  return Buffer.from(await pdfDoc.save());
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
        const printDimensions = getPrintSceneDimensions(note);
        const printWidth = printDimensions.width;
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

        // titleBlockHeightPx can only be derived once the real rendered height is known (the
        // title's own height isn't part of scene bounds — see PrintView.tsx) — skip adding
        // link annotations entirely on the rare timeout fallback (contentHeight === null)
        // rather than guess and place them wrong.
        let finalBuffer: Uint8Array = pdfBuffer;
        if (contentHeight !== null) {
          const titleBlockHeightPx = Math.max(0, contentHeight - printDimensions.height);
          const linkRects = collectLinkRects(note, titleBlockHeightPx);
          if (linkRects.length > 0) {
            finalBuffer = await addLinkAnnotations(pdfBuffer, linkRects, marginTopIn);
          }
        }

        await fs.writeFile(saveResult.filePath, finalBuffer);
        return saveResult.filePath;
      } finally {
        printWin?.destroy();
        exportInFlight = false;
      }
    }
  );
}
