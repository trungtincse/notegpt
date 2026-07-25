import { CaptureUpdateAction, Excalidraw, FONT_FAMILY } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  ensureMarkdownElements,
  isMarkdownElementId,
  parseMarkdownElementId,
  parseNoteLink,
  MARKDOWN_TEXT_COLUMN_WIDTH,
  type AnnotationScene,
  type MarkdownBlock,
} from "@notegpt/core";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { debounce } from "../utils/debounce.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { DEFAULT_STROKE_COLOR, MIN_STROKE_WIDTH, PASTED_TEXT_COLOR } from "./Toolbar.js";

export interface AnnotationOverlayProps {
  markdownBlocks: MarkdownBlock[];
  scene: AnnotationScene;
  onChange: (elements: unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void;
  apiRef?: MutableRefObject<ExcalidrawImperativeAPI | null>;
  /** Read-only: disables editing via Excalidraw's own view mode. Panning/zooming
   * (Excalidraw's native camera) works the same in both modes. */
  viewMode?: boolean;
  /** Positions the camera on the markdown blocks once the scene has mounted, but only for
   * a note that has never had a camera position saved (`scene.appState.scrollX` is still
   * unset) — once the user has panned/zoomed at all, that gets persisted (see
   * PERSISTED_APP_STATE_KEYS below) and is respected on every later open instead. Off
   * entirely for callers (PrintView) that already compute their own exact
   * scrollX/scrollY/zoom to fit all elements into a tightly-sized page — auto-
   * positioning on just the markdown blocks there would fight that and push content
   * outside the page's fixed bounds. */
  centerOnMount?: boolean;
  /** Fires once every markdown block has reported its real (ResizeObserver-measured)
   * height, or a short timeout elapses first — independent of `centerOnMount` (this fires
   * whether or not the camera actually gets repositioned). PrintView uses this instead of a
   * fixed animation-frame delay: Excalidraw's own boot time varies a lot by build (a `vite
   * build` production bundle vs. `electron-vite dev`'s unbundled dev server can differ by a
   * lot more than a couple of frames), so a fixed delay either wastes time or — as happened
   * in dev mode — fires before the scene has even left Excalidraw's own "Loading scene…"
   * placeholder, exporting a PDF with no visible text. */
  onReady?: () => void;
  /** Called instead of the browser's default link-open when a clicked element's link is one of
   * our internal note links (see buildNoteLink/parseNoteLink) — receives the target's absolute
   * .mdnote file path. Omitted (falls back to opening as a real URL, which will just fail to
   * navigate) in contexts with no notion of "another note to switch to", e.g. PrintView. */
  onOpenNoteLink?: (filePath: string) => void;
}

const CHANGE_DEBOUNCE_MS = 400;

/** Gap (scene px) kept above the markdown blocks' top edge when positioning the camera. */
const TOP_ALIGN_PADDING = 40;

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

/** Renders one markdown block at the fixed column width and reports its natural
 * (content-driven) height (identifying which element it measured), so that
 * element's box can be kept in sync. */
function MarkdownEmbeddable({
  elementId,
  markdown,
  onHeightChange,
}: {
  elementId: string;
  markdown: string;
  onHeightChange: (elementId: string, height: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;
  const elementIdRef = useRef(elementId);
  elementIdRef.current = elementId;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    // ResizeObserver (not a one-off measurement) because markdown can contain images
    // that load asynchronously and change the natural height after first paint.
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height;
      if (typeof height === "number") onHeightChangeRef.current(elementIdRef.current, height);
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

export function AnnotationOverlay({
  markdownBlocks,
  scene,
  onChange,
  apiRef: externalApiRef,
  viewMode = false,
  centerOnMount = true,
  onReady,
  onOpenNoteLink,
}: AnnotationOverlayProps) {
  const internalApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const apiRef = externalApiRef ?? internalApiRef;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const markdownById = useMemo(() => new Map(markdownBlocks.map((b) => [b.id, b.markdown])), [markdownBlocks]);

  // A note that's already had a camera position saved (from a previous pan/zoom) keeps it
  // across opens instead of being auto-positioned again — see the centerOnMount prop doc.
  const shouldAutoCenter = centerOnMount && scene.appState.scrollX === undefined;

  const debouncedOnChange = useRef(
    debounce((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      onChangeRef.current(elements as unknown[], pickPersistedAppState(appState), files as Record<string, unknown>);
    }, CHANGE_DEBOUNCE_MS)
  ).current;

  // Set by onPaste, consumed by the very next onChange: marks that whatever text elements
  // show up new in that change came from a paste, so they can be corrected to read as normal
  // body text (see below) instead of Excalidraw's default hand-drawn font/current draw color.
  const justPastedRef = useRef(false);
  // Snapshot of element ids as of the previous onChange, so the paste correction below can
  // tell which elements in the new list are brand new rather than touching pre-existing ones.
  const priorElementIdsRef = useRef<Set<string>>(new Set());

  // The Eraser tool erases whatever it's dragged across indiscriminately, same as any
  // other shape — sticky notes are unlocked (draggable/resizable, see ensureMarkdownElements)
  // so they're just as erasable by default, which isn't wanted: erasing is for hand-drawn
  // annotations, not for deleting a note's text. Undoing the deletion right back keeps the
  // *content* uneraseable while the Delete key (with the note actually selected) and the
  // Markdown tab's own remove button both still work as the deliberate ways to remove one.
  const handleExcalidrawChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      const api = apiRef.current;
      const priorElementIds = priorElementIdsRef.current;
      priorElementIdsRef.current = new Set(elements.map((el) => el.id));

      // Pasted text should read as normal body text (Helvetica, matching the Text tool — see
      // selectTool in Toolbar) in solid black, regardless of whatever color/font the user last
      // drew with. This mutates the just-added element(s) directly (the same
      // updateScene({ elements, captureUpdate: NEVER }) pattern as the eraser correction below)
      // rather than toggling currentItem* appState from inside onPaste, which raced with
      // Excalidraw's own paste handling and made the pasted text unselectable via box-select.
      if (api && justPastedRef.current) {
        justPastedRef.current = false;
        const corrected = elements.map((el) =>
          el.type === "text" && !priorElementIds.has(el.id)
            ? { ...el, strokeColor: PASTED_TEXT_COLOR, fontFamily: FONT_FAMILY.Helvetica }
            : el
        );
        api.updateScene({ elements: corrected, captureUpdate: CaptureUpdateAction.NEVER });
        debouncedOnChange(corrected, appState, files);
        return;
      }

      if (api && appState.activeTool.type === "eraser") {
        let revivedAny = false;
        const corrected = elements.map((el) => {
          if (el.isDeleted && isMarkdownElementId(el.id)) {
            revivedAny = true;
            return { ...el, isDeleted: false };
          }
          return el;
        });
        if (revivedAny) {
          api.updateScene({ elements: corrected, captureUpdate: CaptureUpdateAction.NEVER });
          debouncedOnChange(corrected, appState, files);
          return;
        }
      }
      debouncedOnChange(elements, appState, files);
    },
    [apiRef, debouncedOnChange]
  );

  // Multi-block readiness/centering state, scoped to one mount of this component. Four past
  // bugs (all found the hard way — see git history on this file) must not be reintroduced:
  // (1) centering on the WHOLE scene skews off-center as soon as an annotation sits outside
  //     the markdown columns — only ever center on markdown elements specifically;
  // (2) forcing embeddables' `activeEmbeddable` active gives them `pointer-events: auto`,
  //     which swallows Pen/Highlighter clicks meant for the canvas — never touch it;
  // (3) `excalidrawAPI` (the prop callback below) fires from inside Excalidraw's own
  //     constructor, before it has loaded elements or measured its real container size, so
  //     centering must wait for a later effect/callback, and specifically for each block's
  //     *real* ResizeObserver-measured height, not the placeholder default height that
  //     ensureMarkdownElements gives a freshly-created block;
  // (4) this "block is ready" tracking must run even when `shouldAutoCenter` is false
  //     (PrintView) — it's the only real signal that Excalidraw has actually finished
  //     rendering content, which `onReady` depends on regardless of whether the camera
  //     itself gets repositioned.
  const hasReportedReadyRef = useRef(false);
  const pendingBlockIdsRef = useRef<Set<string> | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw's own default camera (wherever it happens to land before centering runs)
  // is never shown — the overlay stays invisible until the correct position is set, so the
  // user only ever sees the final centered state instead of a visible jump/flash between the
  // two. `visibility: hidden` (not unmounting or display:none) so layout/ResizeObserver
  // measurements underneath still happen normally while hidden. Callers that opt out of
  // centering entirely (PrintView, centerOnMount=false) have nothing to wait for, so they
  // start already revealed.
  const [isPositioned, setIsPositioned] = useState(!shouldAutoCenter);

  // Horizontally centers the markdown blocks, but vertically anchors their top edge near
  // the top of the viewport (with a small padding) instead of vertically centering them —
  // `scrollToContent` centers on both axes, which looks fine horizontally (a row of cards)
  // but leaves a huge, lopsided-feeling gap above short content in a tall/maximized window.
  // Reimplemented by hand (not scrollToContent) since it has no "center X, align-top Y" mode.
  // Fires unconditionally once (the readiness signal callers like PrintView depend on), but
  // only actually moves the camera when `shouldAutoCenter` is true.
  const markReadyAndMaybeCenter = useCallback(
    (api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[]) => {
      if (hasReportedReadyRef.current) return;
      hasReportedReadyRef.current = true;
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      if (shouldAutoCenter && elements.length > 0) {
        const minX = Math.min(...elements.map((el) => el.x));
        const maxX = Math.max(...elements.map((el) => el.x + el.width));
        const minY = Math.min(...elements.map((el) => el.y));
        const appState = api.getAppState();
        const zoom = appState.zoom.value;
        const scrollX = appState.width / 2 / zoom - (minX + maxX) / 2;
        const scrollY = TOP_ALIGN_PADDING / zoom - minY;
        api.updateScene({ appState: { scrollX, scrollY }, captureUpdate: CaptureUpdateAction.NEVER });
      }
      setIsPositioned(true);
      onReadyRef.current?.();
    },
    [shouldAutoCenter]
  );

  const handleHeightChange = useCallback(
    (elementId: string, height: number) => {
      const api = apiRef.current;
      if (!api) return;
      const rounded = Math.round(height);
      const elements = api.getSceneElements();
      const target = elements.find((el) => el.id === elementId);
      if (!target) return;

      let nextElements = elements;
      if (Math.abs(target.height - rounded) >= 1) {
        nextElements = elements.map((el) => (el.id === elementId ? { ...el, height: rounded } : el));
        api.updateScene({ elements: nextElements, captureUpdate: CaptureUpdateAction.NEVER });
      }

      if (hasReportedReadyRef.current) return;
      const pending = pendingBlockIdsRef.current;
      if (!pending) return;
      const blockId = parseMarkdownElementId(elementId);
      if (blockId === null || !pending.has(blockId)) return;
      pending.delete(blockId);
      if (pending.size === 0) {
        markReadyAndMaybeCenter(api, nextElements.filter((el) => isMarkdownElementId(el.id)));
      }
    },
    [apiRef, markReadyAndMaybeCenter]
  );

  // Seeds the pending-block set at mount (only ever run once — deliberately empty deps —
  // so a block added later via "+ Add note" can't re-trigger this) and arms a short fallback
  // timer. Runs regardless of `shouldAutoCenter`/`centerOnMount` — see point (4) above.
  //
  // Deliberately does NOT bail out just because `apiRef.current` isn't set yet: the
  // `excalidrawAPI` ref callback (which sets it, from Excalidraw's own constructor) is not
  // guaranteed to have already fired by the time this effect runs — true for a "warm" mount
  // (e.g. clicking the Annotation tab after the app's been idle), but NOT for a "cold" one
  // nested inside an async-triggered render (e.g. the first-launch welcome note, mounted
  // from a `.then()` callback). Seeding `pending` needs no API access at all, and the
  // fallback timer re-reads `apiRef.current` from inside its own (later) callback instead
  // of capturing it now, so both still work whichever order the two actually fire in.
  //
  // The fallback timer is NOT a rare escape hatch — Excalidraw only mounts an embeddable's
  // React content (and so only starts its ResizeObserver) once that element scrolls into
  // the *current* viewport (see its own `isElementInViewport`/`initializedEmbeds` gating).
  // With several blocks side by side wider than one screen, the ones outside the pre-camera-
  // move default viewport structurally never fire `handleHeightChange` at all — `pending`
  // then never reaches zero, and every such mount hits this timer, using whatever height
  // (real or still-placeholder) each block happens to have at that moment.
  //
  // 3000ms, not something snappier: this genuinely needs to outlast how long Excalidraw
  // itself can take to boot, which varies far more than a couple of animation frames across
  // builds and machine load — a production `vite build` bundle mounts fast, but
  // `electron-vite dev`'s unbundled dev server (plus React StrictMode's double-render) can
  // leave Excalidraw showing its own "Loading scene…" placeholder for anywhere from ~150ms
  // to well over a second depending on system load, which is exactly what silently broke
  // PrintView's PDF export (measuring/printing that placeholder instead of real content) —
  // confirmed flaky even at 800ms under load, not just a one-off fluke. Still comfortably
  // under exportPdf.ts's own outer PRINT_READY_TIMEOUT_MS (5000ms) safety net.
  useEffect(() => {
    const blockIds = markdownBlocks.map((b) => b.id);
    pendingBlockIdsRef.current = new Set(blockIds);

    // Always armed, regardless of whether `pending` is already empty or `apiRef.current` is
    // set yet — the sole guarantee that `onReady`/centering ever fires. The zero-blocks
    // fast-path below is purely an optimization (skips the wait when possible); it must not
    // be the only path, or a zero-block note mounted "cold" (api not ready yet right now)
    // would stay hidden/unsignaled forever with nothing left to trigger it.
    readyTimeoutRef.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const els = api.getSceneElements();
      const markdownEls = els.filter((el) => isMarkdownElementId(el.id));
      markReadyAndMaybeCenter(api, markdownEls.length > 0 ? markdownEls : els);
    }, 3000);

    if (pendingBlockIdsRef.current.size === 0 && apiRef.current) {
      markReadyAndMaybeCenter(apiRef.current, apiRef.current.getSceneElements());
    }

    return () => {
      if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const excalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
    },
    [apiRef]
  );

  return (
    <div className="notegpt-annotation-overlay" style={{ visibility: isPositioned ? "visible" : "hidden" }}>
      <Excalidraw
        excalidrawAPI={excalidrawAPI}
        viewModeEnabled={viewMode}
        validateEmbeddable
        renderEmbeddable={(element) => {
          const blockId = parseMarkdownElementId(element.id);
          if (blockId === null) return null;
          return (
            <MarkdownEmbeddable
              key={element.id}
              elementId={element.id}
              markdown={markdownById.get(blockId) ?? ""}
              onHeightChange={handleHeightChange}
            />
          );
        }}
        onLinkOpen={(element, event) => {
          // The markdown container's `link` is a placeholder, never a real URL (see
          // ensureMarkdownElements) — without this, clicking its hyperlink affordance
          // would try to open "notegpt:markdown" as a real link and fail.
          if (isMarkdownElementId(element.id)) {
            event.preventDefault();
            return;
          }
          const notePath = parseNoteLink(element.link);
          if (notePath) {
            event.preventDefault();
            onOpenNoteLink?.(notePath);
          }
        }}
        // See the paste-correction block in handleExcalidrawChange for why this only sets a
        // flag instead of touching appState/elements here.
        onPaste={() => {
          justPastedRef.current = true;
          return true;
        }}
        initialData={{
          elements: ensureMarkdownElements(scene.elements, markdownBlocks.map((b) => b.id)) as ExcalidrawElement[],
          // Falls back to the toolbar's default swatch/min stroke width when the scene has
          // never set them (brand-new note); an already-persisted value (the user changed it
          // before) always wins.
          appState: {
            currentItemStrokeColor: DEFAULT_STROKE_COLOR,
            currentItemStrokeWidth: MIN_STROKE_WIDTH,
            ...scene.appState,
          } as Partial<AppState>,
          files: scene.files as BinaryFiles,
        }}
        onChange={viewMode ? undefined : handleExcalidrawChange}
      />
    </div>
  );
}
