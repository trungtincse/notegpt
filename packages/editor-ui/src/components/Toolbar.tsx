import { FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ToolType } from "@excalidraw/excalidraw/types";
import {
  Eraser,
  Hand,
  Highlighter as HighlighterIcon,
  Image as ImageIcon,
  LassoSelect,
  type LucideIcon,
  Pencil,
  Trash2,
  Type as TextIcon,
  Undo2,
} from "lucide-react";
import { useState, type RefObject } from "react";

export interface ToolbarProps {
  excalidrawApiRef: RefObject<ExcalidrawImperativeAPI | null>;
}

const HIGHLIGHT_COLOR = "#ffd43b";
const DEFAULT_STROKE_COLOR = "#1e1e1e";
const ICON_SIZE = 18;

const COLOR_SWATCHES = ["#ca0a0a", "#9c36b5", "#2f9e44", "#f5c518", "#1e1e1e"];

/**
 * Excalidraw's own floating toolbar/zoom/help/style-panel chrome is hidden via
 * CSS (.notegpt-annotation-overlay .excalidraw .layer-ui__wrapper) because it's
 * anchored to the edges of the annotation overlay rather than the actual
 * viewport, so it drifts over the markdown text as the pane scrolls. This
 * toolbar, rendered outside the scrollable pane, replaces it.
 */
const DRAW_TOOLS: ReadonlyArray<{ type: ToolType; label: string; Icon: LucideIcon }> = [
  { type: "selection", label: "Select", Icon: LassoSelect },
  { type: "hand", label: "Hand", Icon: Hand },
  { type: "freedraw", label: "Pen", Icon: Pencil },
  { type: "text", label: "Text", Icon: TextIcon },
  { type: "image", label: "Image", Icon: ImageIcon },
  { type: "eraser", label: "Eraser", Icon: Eraser },
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

export function Toolbar({ excalidrawApiRef }: ToolbarProps) {
  const [activeTool, setActiveTool] = useState<ToolType | "highlighter">("selection");
  const [strokeColor, setStrokeColor] = useState(DEFAULT_STROKE_COLOR);

  const selectTool = (type: ToolType) => {
    const api = excalidrawApiRef.current;
    api?.setActiveTool({ type });
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
    api.setActiveTool({ type: "rectangle" });
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
        title="Highlighter"
        aria-label="Highlighter"
        className={activeTool === "highlighter" ? "active" : ""}
        onClick={activateHighlighter}
      >
        <HighlighterIcon size={ICON_SIZE} />
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
        defaultValue={2}
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
    </div>
  );
}
