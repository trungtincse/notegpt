import type { Note } from "@notegpt/core";
import { AnnotationOverlay, MarkdownPreview } from "@notegpt/editor-ui";
import { useEffect, useState } from "react";
import { LocalFsStorageAdapter } from "./adapters/LocalFsStorageAdapter.js";

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
    void waitTwoAnimationFrames().then(() => window.mdnote.notifyPrintReady());
  }, [note]);

  if (!note) return null;

  return (
    <div className="notegpt-print-page">
      <h1 className="notegpt-print-title">{note.title}</h1>
      <div className="notegpt-markdown-content">
        <div className="notegpt-markdown-content-inner">
          <MarkdownPreview markdown={note.markdown} />
        </div>
        <AnnotationOverlay scene={note.annotation} onChange={() => {}} viewMode />
      </div>
    </div>
  );
}
