import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { StorageAdapter } from "@notegpt/core";
import { Eye, Pencil } from "lucide-react";
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

type ShellMode = "edit" | "view";

/**
 * Composition root for the editor. In edit mode: markdown source on the left,
 * the rendered preview with an editable Excalidraw annotation overlay on the
 * right, both scrolling independently. In view mode: only the rendered
 * preview and its annotations, read-only and zoomable via Excalidraw's own
 * pan/zoom. A header button switches between the two.
 */
export function EditorShell({ storage, noteId }: EditorShellProps) {
  const { note, saveStatus, load, updateMarkdown, controller } = useNoteController(storage);
  const { updateScene } = useAnnotationController(controller);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [mode, setMode] = useState<ShellMode>("edit");

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
        <div className="notegpt-editor-shell-header-actions">
          <span className="notegpt-save-status">{saveStatus}</span>
          <button
            type="button"
            className="notegpt-mode-toggle"
            title={mode === "edit" ? "Switch to view mode" : "Switch to edit mode"}
            aria-label={mode === "edit" ? "Switch to view mode" : "Switch to edit mode"}
            onClick={() => setMode((current) => (current === "edit" ? "view" : "edit"))}
          >
            {mode === "edit" ? <Eye size={16} /> : <Pencil size={16} />}
            {mode === "edit" ? "View" : "Edit"}
          </button>
        </div>
      </header>
      <div className={`notegpt-split-view${mode === "view" ? " notegpt-split-view--view" : ""}`}>
        {mode === "edit" && (
          <div className="notegpt-markdown-pane">
            <CodeMirrorEditor docId={note.id} initialValue={note.markdown} editable onChange={updateMarkdown} />
          </div>
        )}
        <div className={`notegpt-annotate-pane${mode === "view" ? " notegpt-annotate-pane--view" : ""}`}>
          {mode === "edit" && <Toolbar excalidrawApiRef={excalidrawApiRef} />}
          <div className="notegpt-markdown-pane">
            <div className="notegpt-markdown-content">
              <MarkdownPreview markdown={note.markdown} />
              <AnnotationOverlay
                key={note.id}
                apiRef={excalidrawApiRef}
                scene={note.annotation}
                onChange={updateScene}
                viewMode={mode === "view"}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
