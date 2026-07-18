import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "react";

export interface ToolbarProps {
  excalidrawApiRef: RefObject<ExcalidrawImperativeAPI | null>;
}

const HIGHLIGHT_COLOR = "#ffd43b";

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
      <button type="button" onClick={activateHighlighter}>
        Highlighter
      </button>
    </div>
  );
}
