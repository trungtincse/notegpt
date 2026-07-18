import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AnnotationScene } from "@notegpt/core";
import { type MutableRefObject, useRef } from "react";
import { debounce } from "../utils/debounce.js";

export interface AnnotationOverlayProps {
  scene: AnnotationScene;
  /** true while in "annotate" mode; controls both pointer-events capture and Excalidraw's view mode. */
  interactive: boolean;
  onChange: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
  apiRef?: MutableRefObject<ExcalidrawImperativeAPI | null>;
}

const CHANGE_DEBOUNCE_MS = 400;

/** Only these AppState fields are worth persisting; the rest is ephemeral UI/collab state. */
const PERSISTED_APP_STATE_KEYS = [
  "viewBackgroundColor",
  "currentItemStrokeColor",
  "currentItemBackgroundColor",
  "currentItemFillStyle",
  "currentItemStrokeWidth",
  "currentItemOpacity",
  "gridSize",
  "zoom",
  "scrollX",
  "scrollY",
] as const satisfies readonly (keyof AppState)[];

function pickPersistedAppState(appState: AppState): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of PERSISTED_APP_STATE_KEYS) {
    picked[key] = appState[key];
  }
  return picked;
}

export function AnnotationOverlay({ scene, interactive, onChange, apiRef: externalApiRef }: AnnotationOverlayProps) {
  const internalApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const apiRef = externalApiRef ?? internalApiRef;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const debouncedOnChange = useRef(
    debounce((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      onChangeRef.current(elements as unknown[], pickPersistedAppState(appState), files as Record<string, unknown>);
    }, CHANGE_DEBOUNCE_MS)
  ).current;

  return (
    <div
      className="notegpt-annotation-overlay"
      style={{ position: "absolute", inset: 0, pointerEvents: interactive ? "auto" : "none" }}
      // Excalidraw's own wheel handler (attached natively on its container) hijacks
      // wheel/trackpad input to pan its own infinite canvas, which stops the markdown
      // pane underneath from ever scrolling. Stop the event here, in the capture phase,
      // before it reaches Excalidraw's listener — the browser then falls through to its
      // default action (scrolling the nearest scrollable ancestor, the markdown pane).
      onWheelCapture={interactive ? (event) => event.stopPropagation() : undefined}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        initialData={{
          elements: scene.elements as ExcalidrawElement[],
          // Force transparent regardless of what's stored: the overlay sits on top of the
          // markdown pane, so an opaque canvas background would hide the text underneath.
          appState: { ...(scene.appState as Partial<AppState>), viewBackgroundColor: "transparent" },
          files: scene.files as BinaryFiles,
        }}
        viewModeEnabled={!interactive}
        onChange={debouncedOnChange}
      />
    </div>
  );
}
