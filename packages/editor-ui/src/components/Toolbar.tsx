import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "react";
import type { EditorMode } from "./ModeToggle.js";

export interface ToolbarProps {
  mode: EditorMode;
  excalidrawApiRef: RefObject<ExcalidrawImperativeAPI | null>;
}

const HIGHLIGHT_COLOR = "#ffd43b";

export function Toolbar({ mode, excalidrawApiRef }: ToolbarProps) {
  if (mode !== "annotate") return null;

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
      <button type="button" onClick={activateHighlighter}>
        Highlighter
      </button>
    </div>
  );
}
