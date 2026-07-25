import { CaptureUpdateAction, Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ensureMarkdownElement, MARKDOWN_ELEMENT_ID, MARKDOWN_TEXT_COLUMN_WIDTH, type AnnotationScene } from "@notegpt/core";
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { debounce } from "../utils/debounce.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { DEFAULT_STROKE_COLOR } from "./Toolbar.js";

export interface AnnotationOverlayProps {
  markdown: string;
  scene: AnnotationScene;
  onChange: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
  apiRef?: MutableRefObject<ExcalidrawImperativeAPI | null>;
  /** Read-only: disables editing via Excalidraw's own view mode. Panning/zooming
   * (Excalidraw's native camera) works the same in both modes. */
  viewMode?: boolean;
  /** Recenters the camera on the markdown column once the scene has mounted.
   * Off by default for callers (PrintView) that already compute their own exact
   * scrollX/scrollY/zoom to fit all elements into a tightly-sized page — auto-
   * centering on just the markdown column there would fight that positioning and
   * push content outside the page's fixed bounds. */
  centerOnMount?: boolean;
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

/** Renders the note's markdown at the fixed column width and reports its natural
 * (content-driven) height, so the embeddable element's box can be kept in sync. */
function MarkdownEmbeddable({ markdown, onHeightChange }: { markdown: string; onHeightChange: (height: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // ResizeObserver (not a one-off measurement) because markdown can contain images
    // that load asynchronously and change the natural height after first paint.
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (typeof height === "number") onHeightChangeRef.current(height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ width: MARKDOWN_TEXT_COLUMN_WIDTH }}>
      <MarkdownPreview markdown={markdown} />
    </div>
  );
}

export function AnnotationOverlay({ markdown, scene, onChange, apiRef: externalApiRef, viewMode = false, centerOnMount = true }: AnnotationOverlayProps) {
  const internalApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const apiRef = externalApiRef ?? internalApiRef;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const debouncedOnChange = useRef(
    debounce((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      onChangeRef.current(elements as unknown[], pickPersistedAppState(appState), files as Record<string, unknown>);
    }, CHANGE_DEBOUNCE_MS)
  ).current;

  const handleHeightChange = useCallback(
    (height: number) => {
      const api = apiRef.current;
      if (!api) return;
      const rounded = Math.round(height);
      const elements = api.getSceneElements();
      const target = elements.find((el) => el.id === MARKDOWN_ELEMENT_ID);
      if (!target || Math.abs(target.height - rounded) < 1) return;
      api.updateScene({
        elements: elements.map((el) => (el.id === MARKDOWN_ELEMENT_ID ? { ...el, height: rounded } : el)),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [apiRef]
  );

  // `excalidrawAPI` (the prop callback below) fires from inside Excalidraw's own
  // constructor — before it has loaded any elements or measured its real
  // container size — so centering the camera has to wait for this effect
  // instead. Child components always finish mounting (Excalidraw's
  // componentDidMount included) before a parent's own effects run, so by here
  // the scene and container size are both ready.
  //
  // Note: this deliberately does NOT force the markdown embeddable's
  // `activeEmbeddable` state to "active" on mount. Excalidraw gives an active
  // embeddable's DOM content `pointer-events: auto` so it can be
  // clicked/scrolled directly — which also means it swallows every pointer
  // event meant for the canvas underneath, making draw tools (pen, highlighter)
  // stop working anywhere over the text column.
  useEffect(() => {
    if (!centerOnMount) return;
    const api = apiRef.current;
    if (!api) return;
    const markdownElement = api.getSceneElements().find((el) => el.id === MARKDOWN_ELEMENT_ID);
    if (!markdownElement) return;
    // Centers the camera on the markdown column specifically — centering on
    // every scene element (via initialData.scrollToContent) skews off-center
    // as soon as an annotation sits outside the column's own bounds.
    api.scrollToContent(markdownElement, { fitToViewport: false, animate: false });
  }, [apiRef, centerOnMount]);

  const excalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
    },
    [apiRef]
  );

  return (
    <div className="notegpt-annotation-overlay">
      <Excalidraw
        excalidrawAPI={excalidrawAPI}
        viewModeEnabled={viewMode}
        validateEmbeddable
        renderEmbeddable={(element) => (element.id === MARKDOWN_ELEMENT_ID ? <MarkdownEmbeddable markdown={markdown} onHeightChange={handleHeightChange} /> : null)}
        // The markdown container's `link` is a placeholder, never a real URL (see
        // ensureMarkdownElement) — without this, clicking its hyperlink affordance
        // would try to open "notegpt:markdown" as a real link and fail.
        onLinkOpen={(element, event) => {
          if (element.id === MARKDOWN_ELEMENT_ID) event.preventDefault();
        }}
        initialData={{
          elements: ensureMarkdownElement(scene.elements) as ExcalidrawElement[],
          // Falls back to the toolbar's default swatch when the scene has never
          // set a stroke color (brand-new note); an already-persisted value
          // (the user picked a color before) always wins.
          appState: { currentItemStrokeColor: DEFAULT_STROKE_COLOR, ...scene.appState } as Partial<AppState>,
          files: scene.files as BinaryFiles,
        }}
        onChange={viewMode ? undefined : debouncedOnChange}
      />
    </div>
  );
}
