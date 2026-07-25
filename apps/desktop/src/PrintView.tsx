import { ensureMarkdownElements, getSceneBounds, isVisiblyRendered, type Note } from "@notegpt/core";
import { AnnotationOverlay } from "@notegpt/editor-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocalFsStorageAdapter } from "./adapters/LocalFsStorageAdapter.js";

// Padding (px) around the scene's content bounds so nothing sits flush against the page edge.
// Larger than it looks like it should need to be: hand-drawn (rough.js) strokes visually
// overshoot their own element's x/y/width/height a bit for the sketchy look, so a shape whose
// logical bounding box sits right at minX/maxX can still render a little outside it — too
// small a padding here clips that overshoot at the page edge instead of framing it.
const CONTENT_PADDING = 150;

/** Waits two animation frames — letting Excalidraw's canvas actually paint — before
 * resolving, instead of guessing a fixed delay that could either race ahead of the
 * paint or pad every export with dead time. */
function waitTwoAnimationFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function PrintView({ folderPath, filePath }: { folderPath: string; filePath: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const adapter = new LocalFsStorageAdapter(folderPath);
      const loaded = await adapter.loadNote(filePath);
      loaded.annotation = await adapter.resolveAssetsForRead(loaded.annotation);
      if (!cancelled) setNote(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [folderPath, filePath]);

  // Fires once AnnotationOverlay's own readiness signal lands — every markdown block has
  // reported its real rendered height (or a fallback timeout inside it gave up waiting) —
  // rather than a fixed animation-frame delay from mount. A fixed delay assumes Excalidraw
  // itself has already finished booting by then, which held for a production `vite build`
  // bundle but not for `electron-vite dev`'s unbundled dev server (plus React StrictMode's
  // double-render): there, PDFs were being captured while Excalidraw was still showing its
  // own "Loading scene…" placeholder, with no visible markdown text at all. Two more
  // animation frames after the signal still ensures the corresponding state updates
  // (e.g. the last per-block height correction) have actually painted before measuring.
  const handleAnnotationReady = useCallback(() => {
    void waitTwoAnimationFrames().then(() => {
      // The title's height isn't part of the scene bounds used to size the page
      // (see printScene below), so the real page height — including it — has to
      // come from measuring the actual rendered DOM, not scene math.
      const height = pageRef.current?.getBoundingClientRect().height ?? 0;
      window.mdnote.notifyPrintReady(height);
    });
  }, []);

  // Excalidraw is a fixed-viewport camera, not an auto-growing document — unlike the
  // old two-layer DOM composition, the print window must be explicitly sized and
  // scrolled to fit the *entire* scene, using the scene's own content bounds.
  const printScene = useMemo(() => {
    if (!note) return null;
    const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
    // Sizing/positioning is based on only the *visible* elements — an invisible leftover
    // stroke (fully transparent stroke and fill, e.g. drawn with the wrong color mid-testing
    // and never cleaned up) still has real x/y/width/height and would otherwise stretch the
    // page out around space nobody can see anything in, throwing left/right margins off
    // balance. All elements are still rendered (nothing is deleted here), just not counted
    // for bounds.
    const { minX, minY, maxX, maxY } = getSceneBounds(elements.filter(isVisiblyRendered));
    return {
      scene: {
        ...note.annotation,
        elements,
        appState: {
          ...note.annotation.appState,
          scrollX: -minX + CONTENT_PADDING,
          scrollY: -minY + CONTENT_PADDING,
          zoom: { value: 1 },
        },
      },
      width: Math.ceil(maxX - minX) + CONTENT_PADDING * 2,
      height: Math.ceil(maxY - minY) + CONTENT_PADDING * 2,
    };
  }, [note]);

  if (!note || !printScene) return null;

  return (
    <div className="notegpt-print-page" ref={pageRef}>
      <h1 className="notegpt-print-title">{note.title}</h1>
      <div style={{ position: "relative", width: printScene.width, height: printScene.height }}>
        <AnnotationOverlay
          markdownBlocks={note.markdownBlocks}
          scene={printScene.scene}
          onChange={() => {}}
          viewMode
          centerOnMount={false}
          onReady={handleAnnotationReady}
        />
      </div>
    </div>
  );
}
