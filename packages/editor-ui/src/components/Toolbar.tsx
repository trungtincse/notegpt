import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ToolType } from "@excalidraw/excalidraw/types";
import {
  ArrowUpRight,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Highlighter as HighlighterIcon,
  Image as ImageIcon,
  type LucideIcon,
  MousePointer2,
  Pencil,
  Slash,
  Square,
  Type,
} from "lucide-react";
import type { RefObject } from "react";

export interface ToolbarProps {
  excalidrawApiRef: RefObject<ExcalidrawImperativeAPI | null>;
}

const HIGHLIGHT_COLOR = "#ffd43b";
const ICON_SIZE = 18;

/**
 * Excalidraw's own floating toolbar/zoom/help/style-panel chrome is hidden via
 * CSS (.notegpt-annotation-overlay .excalidraw .layer-ui__wrapper) because it's
 * anchored to the edges of the annotation overlay rather than the actual
 * viewport, so it drifts over the markdown text as the pane scrolls. This
 * toolbar, rendered outside the scrollable pane, replaces it.
 */
const DRAW_TOOLS: ReadonlyArray<{ type: ToolType; label: string; Icon: LucideIcon }> = [
  { type: "selection", label: "Select", Icon: MousePointer2 },
  { type: "hand", label: "Hand", Icon: Hand },
  { type: "freedraw", label: "Pen", Icon: Pencil },
  { type: "rectangle", label: "Rectangle", Icon: Square },
  { type: "diamond", label: "Diamond", Icon: Diamond },
  { type: "ellipse", label: "Ellipse", Icon: Circle },
  { type: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { type: "line", label: "Line", Icon: Slash },
  { type: "text", label: "Text", Icon: Type },
  { type: "image", label: "Image", Icon: ImageIcon },
  { type: "eraser", label: "Eraser", Icon: Eraser },
];

export function Toolbar({ excalidrawApiRef }: ToolbarProps) {
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
  };

  return (
    <div className="notegpt-toolbar">
      {DRAW_TOOLS.map(({ type, label, Icon }) => (
        <button
          key={type}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => excalidrawApiRef.current?.setActiveTool({ type })}
        >
          <Icon size={ICON_SIZE} />
        </button>
      ))}
      <button type="button" title="Highlighter" aria-label="Highlighter" onClick={activateHighlighter}>
        <HighlighterIcon size={ICON_SIZE} />
      </button>
    </div>
  );
}
