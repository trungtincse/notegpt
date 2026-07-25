import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { isMarkdownElementId, type StorageAdapter } from "@notegpt/core";
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
  /** See AnnotationOverlayProps.onOpenNoteLink. */
  onOpenNoteLink?: (filePath: string) => void;
  /** See ToolbarProps.onPickNoteLink. */
  onPickNoteLink?: () => Promise<string | null>;
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
export function EditorShell({ storage, noteId, initialMode = "markdown", onOpenNoteLink, onPickNoteLink }: EditorShellProps) {
  const { note, saveStatus, loadError, load, addMarkdownBlock, updateMarkdownBlock, renameMarkdownBlock, removeMarkdownBlock, controller } =
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

  // A note that already has something to look at (written text, or hand-drawn annotation
  // — but not just the markdown embeddable's own placeholder element) opens straight on the
  // View tab instead of Markdown, since there's no need to write first before there's
  // anything to read.
  //
  // Deliberately calls setMode() during render (React's documented "adjust state while
  // rendering" pattern — https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // instead of from a useEffect: an effect only runs *after* the browser has already painted
  // the "markdown" tab for one frame, which is exactly the flash the user reported. Calling
  // it here instead makes React throw away that render and redo it before anything paints.
  //
  // The guard MUST be useState, not useRef: StrictMode (see main.tsx) double-invokes the
  // component's render body in dev mode to surface impure renders. A ref mutated directly
  // during render (`ref.current = true`) changes on the first of the two invocations, so the
  // second one — the one React actually keeps — sees it already flipped and skips setMode
  // entirely, silently losing the auto-switch in dev builds only. Reading a state value
  // instead is safe: a setter call doesn't change what the *same* render call reads back,
  // so both invocations see the same prior value and reach the same (correct) decision.
  const [modeDecidedForNoteId, setModeDecidedForNoteId] = useState<string | null>(null);
  if (note && modeDecidedForNoteId !== note.id) {
    setModeDecidedForNoteId(note.id);
    const hasMarkdownContent = note.markdownBlocks.some((b) => b.markdown.trim() !== "");
    const hasAnnotationContent = note.annotation.elements.some((el) => {
      const e = el as { id?: unknown; isDeleted?: boolean };
      return typeof e.id === "string" && !isMarkdownElementId(e.id) && !e.isDeleted;
    });
    if (hasMarkdownContent || hasAnnotationContent) setMode("view");
  }

  if (loadedId === noteId && loadError) {
    return (
      <div className="notegpt-editor-shell-error">
        <p>Couldn't open this note — the file may have been moved, renamed, or deleted.</p>
        <p className="notegpt-editor-shell-error-detail">{loadError}</p>
      </div>
    );
  }

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
            {mode === "annotation" && <Toolbar excalidrawApiRef={excalidrawApiRef} onPickNoteLink={onPickNoteLink} />}
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
                onOpenNoteLink={onOpenNoteLink}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
