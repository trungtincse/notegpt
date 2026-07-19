import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { StorageAdapter } from "@notegpt/core";
import { Code2, Eye, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAnnotationController } from "../hooks/useAnnotationController.js";
import { useNoteController } from "../hooks/useNoteController.js";
import { AnnotationOverlay } from "./AnnotationOverlay.js";
import { CodeMirrorEditor } from "./CodeMirrorEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { Toolbar } from "./Toolbar.js";
import { ZoomableViewport } from "./ZoomableViewport.js";

export interface EditorShellProps {
  storage: StorageAdapter;
  noteId: string;
}

type ShellMode = "markdown" | "annotation" | "view";

/**
 * Composition root for the editor, split into three independent sections
 * shown one at a time: the raw markdown source, an editable Excalidraw
 * annotation overlay atop the rendered preview, and a read-only preview
 * that's pannable/zoomable as one flat surface via ZoomableViewport. A
 * header switcher moves between the three.
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

  const preview = (
    // The text column is capped/centered via the inner wrapper for legibility, but
    // AnnotationOverlay is a direct child of the full-width outer div — its `inset: 0`
    // resolves against that, not the capped column — so the drawing canvas spans the
    // whole pane and leaves room to annotate in the margins beside the text.
    <div className="notegpt-markdown-content">
      <div className="notegpt-markdown-content-inner">
        <MarkdownPreview markdown={note.markdown} />
      </div>
      <AnnotationOverlay
        key={note.id}
        apiRef={excalidrawApiRef}
        scene={note.annotation}
        onChange={updateScene}
        viewMode={mode === "view"}
      />
    </div>
  );

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
        {mode === "annotation" && (
          <div className="notegpt-annotate-pane">
            <Toolbar excalidrawApiRef={excalidrawApiRef} />
            <div className="notegpt-markdown-pane">{preview}</div>
          </div>
        )}
        {mode === "view" && (
          <div className="notegpt-annotate-pane">
            <div className="notegpt-markdown-pane">
              <ZoomableViewport key={note.id}>{preview}</ZoomableViewport>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
