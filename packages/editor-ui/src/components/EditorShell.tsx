import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { StorageAdapter } from "@notegpt/core";
import { useEffect, useRef, useState } from "react";
import { useAnnotationController } from "../hooks/useAnnotationController.js";
import { useNoteController } from "../hooks/useNoteController.js";
import { AnnotationOverlay } from "./AnnotationOverlay.js";
import { CodeMirrorEditor } from "./CodeMirrorEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { ModeToggle, type EditorMode } from "./ModeToggle.js";
import { Toolbar } from "./Toolbar.js";

export interface EditorShellProps {
  storage: StorageAdapter;
  noteId: string;
}

/**
 * Composition root for the editor: a CodeMirror pane with a fixed-size Excalidraw
 * overlay on top. The mode toggle flips pointer-events on the overlay and the
 * `editable` Compartment on CodeMirror so only one layer captures input at a time.
 */
export function EditorShell({ storage, noteId }: EditorShellProps) {
  const { note, saveStatus, load, updateMarkdown, controller } = useNoteController(storage);
  const { updateScene } = useAnnotationController(controller);
  const [mode, setMode] = useState<EditorMode>("edit");
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  // `noteId` is the adapter's opaque address (e.g. a file path), distinct from
  // `note.id` (the note's own stable content identity) — track load completion
  // for this specific request instead of comparing the two id spaces directly.
  const requestedIdRef = useRef<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    requestedIdRef.current = noteId;
    setMode("edit");
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
        <ModeToggle mode={mode} onChange={setMode} />
        <span className="notegpt-save-status">{saveStatus}</span>
      </header>
      <Toolbar mode={mode} excalidrawApiRef={excalidrawApiRef} />
      <div className="notegpt-markdown-pane">
        {/* CodeMirror stays mounted (just hidden) across mode switches so cursor/undo state survives. */}
        <div style={{ display: mode === "edit" ? "block" : "none", height: "100%" }}>
          <CodeMirrorEditor
            docId={note.id}
            initialValue={note.markdown}
            editable={mode === "edit"}
            onChange={updateMarkdown}
          />
        </div>
        {mode === "annotate" && <MarkdownPreview markdown={note.markdown} />}
        <AnnotationOverlay
          key={note.id}
          apiRef={excalidrawApiRef}
          scene={note.annotation}
          interactive={mode === "annotate"}
          onChange={updateScene}
        />
      </div>
    </div>
  );
}
