import { CaptureUpdateAction, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ToolType } from "@excalidraw/excalidraw/types";
import { buildCardLink, buildNoteLink, parseCardLink, parseNoteLink, type MarkdownBlock } from "@notegpt/core";
import {
  ArrowRight,
  Eraser,
  Hand,
  Highlighter as HighlighterIcon,
  Home,
  Image as ImageIcon,
  LassoSelect,
  Link as LinkIcon,
  type LucideIcon,
  Pencil,
  Trash2,
  Type as TextIcon,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

export interface ToolbarProps {
  excalidrawApiRef: RefObject<ExcalidrawImperativeAPI | null>;
  /** Opens a native file picker for another .mdnote file, returning its absolute path (or null
   * if canceled). Desktop-only, so omitted (hiding the "pick another note" option) in contexts
   * without one, e.g. a future web build. */
  onPickNoteLink?: () => Promise<string | null>;
  /** This note's own cards, so the link popover can offer "jump to this card" as a link target
   * (see buildCardLink/AnnotationOverlay's onLinkOpen) alongside a real URL or another note. */
  markdownBlocks: MarkdownBlock[];
}

const HIGHLIGHT_COLOR = "#ffd43b";
export const DEFAULT_STROKE_COLOR = "#ca0a0a";
export const MIN_STROKE_WIDTH = 1;
const ICON_SIZE = 18;

const BLACK_SWATCH = "#1e1e1e";
export const PASTED_TEXT_COLOR = BLACK_SWATCH;

const COLOR_SWATCHES = ["#ca0a0a", "#9c36b5", "#2f9e44", "#f5c518", BLACK_SWATCH];

/**
 * Excalidraw's own floating toolbar/zoom/help/style-panel chrome is hidden via
 * CSS (.notegpt-annotation-overlay .excalidraw .layer-ui__wrapper) because it's
 * anchored to the edges of the annotation overlay rather than the actual
 * viewport, so it drifts over the markdown text as the pane scrolls. This
 * toolbar, rendered outside the scrollable pane, replaces it.
 */
// Highlighter (a special-cased "rectangle" tool, not a real ToolType — see
// activateHighlighter) renders between Image and Eraser, so it's split out of this
// list rather than appended after it.
const DRAW_TOOLS: ReadonlyArray<{ type: ToolType; label: string; Icon: LucideIcon }> = [
  { type: "hand", label: "F1 - Hand", Icon: Hand },
  { type: "selection", label: "F2 - Select", Icon: LassoSelect },
  { type: "freedraw", label: "F3 - Pen", Icon: Pencil },
  { type: "arrow", label: "F4 - Arrow", Icon: ArrowRight },
  { type: "text", label: "F5 - Text", Icon: TextIcon },
  { type: "image", label: "F6 - Image", Icon: ImageIcon },
];

/** Excalidraw's imperative API has no undo/delete methods, only `history.clear()`
 * (wipes history) and `resetScene()` (wipes the canvas) — neither is "undo one
 * step" or "delete selection". Its keyboard shortcuts do both, so we dispatch
 * synthetic key events at its container to trigger the same internal handlers. */
function dispatchToExcalidraw(key: string, options: KeyboardEventInit = {}) {
  const container = document.querySelector<HTMLElement>(".notegpt-annotation-overlay .excalidraw");
  if (!container) return;
  container.focus();
  container.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
}

/** Mirrors EditorShell's own positional "Card N" fallback (see startRename) so a card link's
 * label stays consistent with what its tab shows, even before the card is given a real title. */
function cardLabel(blocks: MarkdownBlock[], blockId: string): string {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1) return "(deleted card)";
  return blocks[index].title || `Card ${index + 1}`;
}

export function Toolbar({ excalidrawApiRef, onPickNoteLink, markdownBlocks }: ToolbarProps) {
  const [activeTool, setActiveTool] = useState<ToolType | "highlighter">("hand");
  const [strokeColor, setStrokeColor] = useState(DEFAULT_STROKE_COLOR);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  // Set when the selected element's current link is one of our internal note links, so the
  // popover can show what it's currently pointing at instead of a raw encoded URL.
  const [linkTargetNotePath, setLinkTargetNotePath] = useState<string | null>(null);
  // Same idea, for a link to one of this note's own cards (see buildCardLink) — holds the
  // target block's id, not its label, since the label can change (rename) after the link is set.
  const [linkTargetCardId, setLinkTargetCardId] = useState<string | null>(null);

  useEffect(() => {
    if (!linkPopoverOpen) return;
    const close = () => setLinkPopoverOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [linkPopoverOpen]);

  // Hand is the default tool the moment the Annotation tab opens — panning around a note
  // should never accidentally start a drawing/selection gesture. Toolbar only ever mounts
  // from the user directly clicking the "Annotation" tab (see EditorShell), so Excalidraw's
  // own constructor (which sets excalidrawApiRef.current) has always already run by the time
  // this effect fires — unlike AnnotationOverlay's own centering logic, which has to guard
  // against a "cold", async-triggered mount that can't happen here.
  useEffect(() => {
    excalidrawApiRef.current?.setActiveTool({ type: "hand", locked: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectTool = (type: ToolType) => {
    const api = excalidrawApiRef.current;
    // locked: true keeps the tool active after finishing a draw — Excalidraw's
    // default is to revert to "selection" after every shape/stroke, which without
    // this would force re-clicking the tool button before every single draw.
    api?.setActiveTool({ type, locked: true });
    // currentItemOpacity/currentItemBackgroundColor are shared appState values, not scoped
    // to the highlighter tool — without resetting them here, switching away from the
    // highlighter (which sets 40% opacity and a solid yellow fill for its translucent look)
    // would leave every other tool drawing at that opacity, and would fill in any freedraw
    // stroke closed into a loop with that same leftover color.
    // currentItemFontFamily defaults to Excalidraw's hand-drawn "Virgil" font — Helvetica
    // reads as normal text instead, matching the rest of the app's UI font.
    api?.updateScene({
      appState: { currentItemOpacity: 100, currentItemBackgroundColor: "transparent", currentItemFontFamily: FONT_FAMILY.Helvetica },
    });
    setActiveTool(type);
  };

  const activateHighlighter = () => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    api.setActiveTool({ type: "rectangle", locked: true });
    api.updateScene({
      appState: {
        currentItemStrokeColor: "transparent",
        currentItemBackgroundColor: HIGHLIGHT_COLOR,
        currentItemFillStyle: "solid",
        currentItemOpacity: 40,
      },
    });
    setActiveTool("highlighter");
  };

  const handleColorChange = (color: string) => {
    setStrokeColor(color);
    excalidrawApiRef.current?.updateScene({ appState: { currentItemStrokeColor: color } });
  };

  const openLinkPopover = () => {
    const api = excalidrawApiRef.current;
    if (!api) return;
    const appState = api.getAppState();
    const selectedIds = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
    if (selectedIds.length !== 1) return;
    const target = api.getSceneElements().find((el) => el.id === selectedIds[0]);
    if (!target) return;
    const internalPath = parseNoteLink(target.link);
    const cardId = parseCardLink(target.link);
    setLinkTargetId(target.id);
    setLinkTargetNotePath(internalPath);
    setLinkTargetCardId(cardId);
    setLinkDraft(internalPath || cardId ? "" : (target.link ?? ""));
    setLinkPopoverOpen(true);
  };

  const applyLink = (link: string | null) => {
    const api = excalidrawApiRef.current;
    if (!api || !linkTargetId) return;
    const elements = api.getSceneElements();
    const updated = elements.map((el) => (el.id === linkTargetId ? { ...el, link } : el));
    api.updateScene({ elements: updated, captureUpdate: CaptureUpdateAction.NEVER });
  };

  const commitUrlLink = () => {
    applyLink(linkDraft.trim() || null);
    setLinkPopoverOpen(false);
  };

  const handlePickNoteLink = async () => {
    if (!onPickNoteLink) return;
    const path = await onPickNoteLink();
    if (!path) return;
    applyLink(buildNoteLink(path));
    setLinkPopoverOpen(false);
  };

  const handlePickCard = (blockId: string) => {
    applyLink(buildCardLink(blockId));
    setLinkPopoverOpen(false);
  };

  const clearLink = () => {
    applyLink(null);
    setLinkPopoverOpen(false);
  };

  // F1–F8 mirror the toolbar's own left-to-right button order (Hand through Eraser) as quick
  // keyboard shortcuts — Link is skipped (it needs a single element already selected, so it
  // doesn't work as a plain toggle-tool shortcut the way the others do), so Eraser takes F8
  // instead of F9. Kept in a ref (rebuilt every render) rather than as a useCallback with a big
  // dependency list, so the listener below can subscribe once on mount instead of tearing
  // down/re-adding on every state change, while still always calling the latest closures
  // instead of stale ones from the first render.
  const keyActionsRef = useRef<Record<string, () => void>>({});
  keyActionsRef.current = {
    F1: () => selectTool("hand"),
    F2: () => selectTool("selection"),
    F3: () => selectTool("freedraw"),
    F4: () => selectTool("arrow"),
    F5: () => selectTool("text"),
    F6: () => selectTool("image"),
    F7: () => activateHighlighter(),
    F8: () => selectTool("eraser"),
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = keyActionsRef.current[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="notegpt-toolbar">
      {DRAW_TOOLS.map(({ type, label, Icon }) => (
        <button
          key={type}
          type="button"
          title={label}
          aria-label={label}
          className={activeTool === type ? "active" : ""}
          onClick={() => selectTool(type)}
        >
          <Icon size={ICON_SIZE} />
        </button>
      ))}
      <button
        type="button"
        title="F7 - Highlighter"
        aria-label="Highlighter"
        className={activeTool === "highlighter" ? "active" : ""}
        onClick={activateHighlighter}
      >
        <HighlighterIcon size={ICON_SIZE} />
      </button>

      <button
        type="button"
        title="Add link (select one element first)"
        aria-label="Add link"
        onClick={(e) => {
          e.stopPropagation();
          openLinkPopover();
        }}
      >
        <LinkIcon size={ICON_SIZE} />
      </button>

      {linkPopoverOpen && (
        <div className="notegpt-link-popover" onClick={(e) => e.stopPropagation()}>
          {linkTargetNotePath && (
            <div className="notegpt-link-popover-current" title={linkTargetNotePath}>
              Linked to note: {linkTargetNotePath}
            </div>
          )}
          {linkTargetCardId && (
            <div className="notegpt-link-popover-current">
              Linked to card: {cardLabel(markdownBlocks, linkTargetCardId)}
            </div>
          )}
          <input
            type="text"
            className="notegpt-link-popover-input"
            placeholder="https://..."
            value={linkDraft}
            autoFocus
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitUrlLink();
              if (e.key === "Escape") setLinkPopoverOpen(false);
            }}
          />
          {onPickNoteLink && (
            <button type="button" className="notegpt-link-popover-pick-note" onClick={() => void handlePickNoteLink()}>
              Choose another note…
            </button>
          )}
          {markdownBlocks.length > 0 && (
            <select
              className="notegpt-link-popover-pick-note"
              value=""
              onChange={(e) => {
                if (e.target.value) handlePickCard(e.target.value);
              }}
            >
              <option value="" disabled>
                Link to a card in this note…
              </option>
              {markdownBlocks.map((block, index) => (
                <option key={block.id} value={block.id}>
                  {block.title || `Card ${index + 1}`}
                </option>
              ))}
            </select>
          )}
          <div className="notegpt-link-popover-actions">
            <button type="button" className="notegpt-link-popover-btn danger" onClick={clearLink}>
              Remove link
            </button>
            <button type="button" className="notegpt-link-popover-btn" onClick={() => setLinkPopoverOpen(false)}>
              Cancel
            </button>
            <button type="button" className="notegpt-link-popover-btn primary" onClick={commitUrlLink}>
              Save
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        title="F8 - Eraser"
        aria-label="Eraser"
        className={activeTool === "eraser" ? "active" : ""}
        onClick={() => selectTool("eraser")}
      >
        <Eraser size={ICON_SIZE} />
      </button>

      <div className="notegpt-toolbar-divider" />

      {COLOR_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          title={color}
          aria-label={`Color ${color}`}
          className={`notegpt-toolbar-swatch${strokeColor === color ? " active" : ""}`}
          style={{ backgroundColor: color }}
          onClick={() => handleColorChange(color)}
        />
      ))}

      <input
        className="notegpt-toolbar-slider"
        type="range"
        min={1}
        max={20}
        defaultValue={MIN_STROKE_WIDTH}
        title="Stroke width"
        aria-label="Stroke width"
        onChange={(event) =>
          excalidrawApiRef.current?.updateScene({
            appState: { currentItemStrokeWidth: Number(event.target.value) },
          })
        }
      />

      <div className="notegpt-toolbar-divider" />

      <button type="button" title="Undo" aria-label="Undo" onClick={() => dispatchToExcalidraw("z", { ctrlKey: true, metaKey: true })}>
        <Undo2 size={ICON_SIZE} />
      </button>
      <button type="button" title="Delete selected" aria-label="Delete selected" onClick={() => dispatchToExcalidraw("Delete")}>
        <Trash2 size={ICON_SIZE} />
      </button>
      <button
        type="button"
        title="Shift+1 - Zoom to fit"
        aria-label="Zoom to fit"
        onClick={() => dispatchToExcalidraw("1", { code: "Digit1", shiftKey: true })}
      >
        <Home size={ICON_SIZE} />
      </button>
    </div>
  );
}
