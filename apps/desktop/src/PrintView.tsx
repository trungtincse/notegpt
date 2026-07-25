import { ensureMarkdownElements, getSceneBounds, type Note } from "@notegpt/core";
import { AnnotationOverlay } from "@notegpt/editor-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { LocalFsStorageAdapter } from "./adapters/LocalFsStorageAdapter.js";

// Padding (px) around the scene's content bounds so nothing sits flush against the page edge.
const CONTENT_PADDING = 40;

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

  useEffect(() => {
    if (!note) return;
    void waitTwoAnimationFrames().then(() => {
      // The title's height isn't part of the scene bounds used to size the page
      // (see printScene below), so the real page height — including it — has to
      // come from measuring the actual rendered DOM, not scene math.
      const height = pageRef.current?.getBoundingClientRect().height ?? 0;
      window.mdnote.notifyPrintReady(height);
    });
  }, [note]);

  // Excalidraw is a fixed-viewport camera, not an auto-growing document — unlike the
  // old two-layer DOM composition, the print window must be explicitly sized and
  // scrolled to fit the *entire* scene, using the scene's own content bounds.
  const printScene = useMemo(() => {
    if (!note) return null;
    const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
    const { minX, minY, maxX, maxY } = getSceneBounds(elements);
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
        <AnnotationOverlay markdownBlocks={note.markdownBlocks} scene={printScene.scene} onChange={() => {}} viewMode centerOnMount={false} />
      </div>
    </div>
  );
}
