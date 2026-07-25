import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { StorageAdapter } from "@notegpt/core";
import { Code2, Eye, PenLine, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAnnotationController } from "../hooks/useAnnotationController.js";
import { useNoteController } from "../hooks/useNoteController.js";
import { AnnotationOverlay } from "./AnnotationOverlay.js";
import { CodeMirrorEditor } from "./CodeMirrorEditor.js";
import { Toolbar } from "./Toolbar.js";

export type ShellMode = "markdown" | "annotation" | "view";

export interface EditorShellProps {
  storage: StorageAdapter;
  noteId: string;
  /** Which of the three tabs is showing first. Defaults to "markdown"; callers that open a
   * note purely for reading (e.g. a bundled first-launch intro note) can start on "view". */
  initialMode?: ShellMode;
}

/**
 * Composition root for the editor, split into three independent sections
 * shown one at a time: the raw markdown blocks, an editable Excalidraw
 * annotation overlay (each block's markdown lives inside the same scene as
 * an unlocked, draggable embeddable element — see AnnotationOverlay), and a
 * read-only view of that same scene. Annotation and view modes share the
 * exact same rendering, differing only in whether editing/drawing is
 * enabled — Excalidraw's own camera provides pan/zoom for both. A header
 * switcher moves between the three.
 */
export function EditorShell({ storage, noteId, initialMode = "markdown" }: EditorShellProps) {
  const { note, saveStatus, load, addMarkdownBlock, updateMarkdownBlock, renameMarkdownBlock, removeMarkdownBlock, controller } =
    useNoteController(storage);
  const { updateScene } = useAnnotationController(controller);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [mode, setMode] = useState<ShellMode>(initialMode);
  // Which block's editor is showing in the Markdown tab. Falls back to the first block
  // whenever this doesn't match a live block (initial mount, the active block got removed
  // via its tab's close button, or deleted via canvas — see AnnotationController's prune)
  // instead of needing a dedicated sync effect.
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [renamingBlockId, setRenamingBlockId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

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

  const activeBlock = note.markdownBlocks.find((b) => b.id === activeBlockId) ?? note.markdownBlocks[0] ?? null;

  const handleAddBlock = () => {
    const id = addMarkdownBlock();
    setActiveBlockId(id);
  };

  const handleRemoveBlock = (blockId: string) => {
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    removeMarkdownBlock(blockId);
  };

  const startRename = (block: (typeof note.markdownBlocks)[number], index: number) => {
    setRenamingBlockId(block.id);
    setRenameDraft(block.title ?? `Note ${index + 1}`);
  };

  const commitRename = () => {
    if (renamingBlockId) renameMarkdownBlock(renamingBlockId, renameDraft.trim());
    setRenamingBlockId(null);
  };

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
          <div className="notegpt-markdown-pane notegpt-markdown-tabbed">
            {note.markdownBlocks.length > 0 && (
              <div className="notegpt-markdown-tabs" role="tablist">
                {note.markdownBlocks.map((block, index) => (
                  <div
                    key={block.id}
                    role="tab"
                    tabIndex={0}
                    aria-selected={block.id === activeBlock?.id}
                    className={`notegpt-markdown-tab${block.id === activeBlock?.id ? " active" : ""}`}
                    onClick={() => setActiveBlockId(block.id)}
                    onDoubleClick={() => startRename(block, index)}
                  >
                    {renamingBlockId === block.id ? (
                      <input
                        autoFocus
                        className="notegpt-markdown-tab-rename-input"
                        value={renameDraft}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename();
                          if (event.key === "Escape") setRenamingBlockId(null);
                        }}
                      />
                    ) : (
                      <span className="notegpt-markdown-tab-label">{block.title || `Note ${index + 1}`}</span>
                    )}
                    <button
                      type="button"
                      className="notegpt-markdown-tab-remove"
                      aria-label="Delete note"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveBlock(block.id);
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button type="button" className="notegpt-markdown-tab-add" aria-label="Add note" onClick={handleAddBlock}>
                  <Plus size={14} />
                </button>
              </div>
            )}
            <div className="notegpt-markdown-tab-content">
              {activeBlock ? (
                <CodeMirrorEditor
                  docId={`${note.id}:${activeBlock.id}`}
                  initialValue={activeBlock.markdown}
                  editable
                  onChange={(markdown) => updateMarkdownBlock(activeBlock.id, markdown)}
                />
              ) : (
                <div className="notegpt-markdown-empty-state">
                  <p>This note has no text yet.</p>
                  <button type="button" className="notegpt-add-block-btn" onClick={handleAddBlock}>
                    <Plus size={16} />
                    Add note
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {(mode === "annotation" || mode === "view") && (
          <div className="notegpt-annotate-pane">
            {mode === "annotation" && <Toolbar excalidrawApiRef={excalidrawApiRef} />}
            <div className="notegpt-markdown-pane">
              {/* Backfills a canvas embeddable for any block that doesn't have one yet
                  (new blocks added via the "+ Add note" button above, since that button
                  only exists while this whole subtree is unmounted — see
                  ensureMarkdownElements/AnnotationOverlay). This relies on AnnotationOverlay
                  genuinely (re)mounting on every markdown<->annotation tab switch; if this
                  is ever changed to stay always-mounted (e.g. CSS-hidden instead of
                  conditional JSX), newly-added blocks would stop appearing until reload. */}
              <AnnotationOverlay
                key={note.id}
                apiRef={excalidrawApiRef}
                markdownBlocks={note.markdownBlocks}
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
