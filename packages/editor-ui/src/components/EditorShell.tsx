import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { StorageAdapter } from "@notegpt/core";
import { useEffect, useRef, useState } from "react";
import { useAnnotationController } from "../hooks/useAnnotationController.js";
import { useNoteController } from "../hooks/useNoteController.js";
import { AnnotationOverlay } from "./AnnotationOverlay.js";
import { CodeMirrorEditor } from "./CodeMirrorEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { Toolbar } from "./Toolbar.js";

export interface EditorShellProps {
  storage: StorageAdapter;
  noteId: string;
}

/**
 * Composition root for the editor: markdown source on the left, the rendered
 * preview with an Excalidraw annotation overlay on the right — both always
 * visible side by side, each pane scrolling independently.
 */
export function EditorShell({ storage, noteId }: EditorShellProps) {
  const { note, saveStatus, load, updateMarkdown, controller } = useNoteController(storage);
  const { updateScene } = useAnnotationController(controller);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  // `noteId` is the adapter's opaque address (e.g. a file path), distinct from
  // `note.id` (the note's own stable content identity) — track load completion
  // for this specific request instead of comparing the two id spaces directly.
  const requestedIdRef = useRef<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    requestedIdRef.current = noteId;
    void load(noteId).then(() => {
      if (requestedIdRef.current === noteId) setLoadedId(noteId);
    });
  }, [noteId]);

  if (!note || loadedId !== noteId) {
    return <div className="notegpt-editor-shell-loading">Loading…</div>;
  }

  return (
    <div className="notegpt-editor-shell">
      <header className="notegpt-editor-shell-header">
        <span>{note.title}</span>
        <span className="notegpt-save-status">{saveStatus}</span>
      </header>
      <Toolbar excalidrawApiRef={excalidrawApiRef} />
      <div className="notegpt-split-view">
        <div className="notegpt-markdown-pane">
          <CodeMirrorEditor docId={note.id} initialValue={note.markdown} editable onChange={updateMarkdown} />
        </div>
        <div className="notegpt-markdown-pane">
          <MarkdownPreview markdown={note.markdown} />
          <AnnotationOverlay key={note.id} apiRef={excalidrawApiRef} scene={note.annotation} onChange={updateScene} />
        </div>
      </div>
    </div>
  );
}
