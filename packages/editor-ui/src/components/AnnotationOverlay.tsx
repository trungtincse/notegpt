import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AnnotationScene } from "@notegpt/core";
import { type MutableRefObject, useRef } from "react";
import { debounce } from "../utils/debounce.js";

export interface AnnotationOverlayProps {
  scene: AnnotationScene;
  onChange: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>, paneWidth: number) => void;
  apiRef?: MutableRefObject<ExcalidrawImperativeAPI | null>;
  /** Read-only: disables editing. Pan/zoom in this mode is driven externally (see ZoomableViewport), not by Excalidraw itself. */
  viewMode?: boolean;
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

export function AnnotationOverlay({ scene, onChange, apiRef: externalApiRef, viewMode = false }: AnnotationOverlayProps) {
  const internalApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const apiRef = externalApiRef ?? internalApiRef;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Read at the moment the (debounced) save actually fires, not when it's scheduled, so it
  // reflects the pane's current size — this is what later lets a consumer (PDF export) know
  // whether elements sit under the centered text column or extend into the margins beside it.
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedOnChange = useRef(
    debounce((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const paneWidth = containerRef.current?.clientWidth ?? 0;
      onChangeRef.current(elements as unknown[], pickPersistedAppState(appState), files as Record<string, unknown>, paneWidth);
    }, CHANGE_DEBOUNCE_MS)
  ).current;

  return (
    <div
      ref={containerRef}
      className="notegpt-annotation-overlay"
      // In view mode Excalidraw must not receive any pointer input at all — it has its
      // own drag-to-pan behavior which would move only the annotation canvas, not the
      // markdown text underneath, the moment a stray mousedown/drag reached it. Making
      // it pointer-events: none hands *all* mouse/touch interaction to ZoomableViewport
      // (an ancestor), which pans/zooms both layers together as one surface instead.
      style={{ position: "absolute", inset: 0, pointerEvents: viewMode ? "none" : "auto" }}
      // Excalidraw's own wheel handler (attached natively on its container) hijacks
      // wheel/trackpad input to pan+zoom its own infinite canvas. In edit mode that
      // stops the markdown pane underneath from ever scrolling, so it's stopped here,
      // in the capture phase, before it reaches Excalidraw's listener — the browser
      // then falls through to its default action (scrolling the markdown pane). In view
      // mode, pointer-events: none above already keeps wheel events from ever reaching
      // Excalidraw in the first place, so this handler is edit-mode-only in practice.
      onWheelCapture={(event) => event.stopPropagation()}
    >
      <Excalidraw
        excalidrawAPI={(api) => {
          apiRef.current = api;
        }}
        viewModeEnabled={viewMode}
        initialData={{
          elements: scene.elements as ExcalidrawElement[],
          // Force transparent regardless of what's stored: the overlay sits on top of the
          // markdown pane, so an opaque canvas background would hide the text underneath.
          appState: { ...(scene.appState as Partial<AppState>), viewBackgroundColor: "transparent" },
          files: scene.files as BinaryFiles,
        }}
        onChange={viewMode ? undefined : debouncedOnChange}
      />
    </div>
  );
}
