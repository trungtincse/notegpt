import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { StorageAdapter } from "@notegpt/core";
import { Code2, Eye, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAnnotationController } from "../hooks/useAnnotationController.js";
import { useNoteController } from "../hooks/useNoteController.js";
import { AnnotationOverlay } from "./AnnotationOverlay.js";
import { CodeMirrorEditor } from "./CodeMirrorEditor.js";
import { Toolbar } from "./Toolbar.js";

export interface EditorShellProps {
  storage: StorageAdapter;
  noteId: string;
}

type ShellMode = "markdown" | "annotation" | "view";

/**
 * Composition root for the editor, split into three independent sections
 * shown one at a time: the raw markdown source, an editable Excalidraw
 * annotation overlay (markdown text lives inside the same scene as a
 * locked embeddable element — see AnnotationOverlay), and a read-only
 * view of that same scene. Annotation and view modes share the exact
 * same rendering, differing only in whether editing/drawing is enabled —
 * Excalidraw's own camera provides pan/zoom for both. A header switcher
 * moves between the three.
 */
export function EditorShell({ storage, noteId }: EditorShellProps) {
  const { note, saveStatus, load, updateMarkdown, controller } = useNoteController(storage);
  const { updateScene } = useAnnotationController(controller);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [mode, setMode] = useState<ShellMode>("markdown");

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
          <div className="notegpt-mode-switcher" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "markdown"}
              className={`notegpt-mode-switcher-btn${mode === "markdown" ? " active" : ""}`}
              onClick={() => setMode("markdown")}
            >
              <Code2 size={16} />
              Markdown
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "annotation"}
              className={`notegpt-mode-switcher-btn${mode === "annotation" ? " active" : ""}`}
              onClick={() => setMode("annotation")}
            >
              <PenLine size={16} />
              Annotation
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "view"}
              className={`notegpt-mode-switcher-btn${mode === "view" ? " active" : ""}`}
              onClick={() => setMode("view")}
            >
              <Eye size={16} />
              View
            </button>
          </div>
        </div>
      </header>
      <div className="notegpt-split-view">
        {mode === "markdown" && (
          <div className="notegpt-markdown-pane">
            <CodeMirrorEditor docId={note.id} initialValue={note.markdown} editable onChange={updateMarkdown} />
          </div>
        )}
        {(mode === "annotation" || mode === "view") && (
          <div className="notegpt-annotate-pane">
            {mode === "annotation" && <Toolbar excalidrawApiRef={excalidrawApiRef} />}
            <div className="notegpt-markdown-pane">
              <AnnotationOverlay
                key={note.id}
                apiRef={excalidrawApiRef}
                markdown={note.markdown}
                scene={note.annotation}
                onChange={updateScene}
                viewMode={mode === "view"}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
