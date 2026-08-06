import { CaptureUpdateAction, Excalidraw, FONT_FAMILY, restoreElements, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  buildMarkdownElement,
  ensureMarkdownElements,
  extractTiktokVideoId,
  fetchTiktokOEmbed,
  isMarkdownElementId,
  looksLikeMarkdown,
  parseMarkdownElementId,
  parseNoteLink,
  parseTiktokEmbedCode,
  reconcileMarkdownSearchElements,
  MARKDOWN_DEFAULT_HEIGHT,
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
  /** Creates a brand new markdown block with the given content and returns its id — called
   * when a paste onto the canvas is detected as Markdown (see looksLikeMarkdown), so it can
   * become its own note instead of a plain Excalidraw text element. Omitted (falls back to
   * Excalidraw's own default paste handling for markdown-looking text too) in contexts with no
   * notion of adding a block, e.g. PrintView. */
  onCreateMarkdownBlock?: (markdown: string) => string;
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

/** Renders a TikTok embeddable as its oEmbed thumbnail image rather than a live iframe —
 * TikTok's frame-ancestors policy blocks the plain watch-page URL, and unlike YouTube/Vimeo
 * there's no static thumbnail CDN URL, so the thumbnail has to come from a network oEmbed
 * call (see fetchTiktokOEmbed). Nothing is rendered until that call resolves, mirroring
 * replaceTiktokEmbedsForPrint's same "leave it be on failure" behavior for a slow/offline
 * network or an oEmbed miss.
 *
 * Once the image has loaded, its real natural aspect ratio corrects the *element's own*
 * stored height (keeping its current width) via a direct updateScene — not just a DOM/CSS
 * resize. Excalidraw draws the embeddable's selection/frame border on the canvas straight
 * from the element's width/height fields, independent of whatever the DOM overlay looks
 * like, so only correcting the element's real data fixes both the image display and that
 * border at once. `captureUpdate: NEVER` (same as the eraser/paste corrections elsewhere in
 * this file) because this is a housekeeping correction, not a user action worth its own undo
 * step. */
function TiktokThumbnail({
  element,
  apiRef,
}: {
  element: ExcalidrawElement;
  apiRef: MutableRefObject<ExcalidrawImperativeAPI | null>;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const videoUrl = typeof element.link === "string" ? element.link : "";
  const elementId = element.id;

  useEffect(() => {
    let cancelled = false;
    setThumbnailUrl(null);
    fetchTiktokOEmbed(videoUrl).then((oEmbed) => {
      if (!cancelled && oEmbed) setThumbnailUrl(oEmbed.thumbnailUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  const handleLoad = useCallback(
    (e: { currentTarget: HTMLImageElement }) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      const api = apiRef.current;
      if (!naturalWidth || !naturalHeight || !api) return;
      const current = api.getSceneElements().find((el) => el.id === elementId);
      if (!current) return;
      const targetHeight = Math.round((current.width * naturalHeight) / naturalWidth);
      if (Math.abs(current.height - targetHeight) < 1) return;
      api.updateScene({
        elements: api.getSceneElements().map((el) => (el.id === elementId ? { ...el, height: targetHeight } : el)),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    [apiRef, elementId]
  );

  if (!thumbnailUrl) return null;

  return (
    <img
      src={thumbnailUrl}
      onLoad={handleLoad}
      alt="TikTok video thumbnail"
      // "contain" (not "cover") covers the brief window before the load-time correction above
      // has run (or if it can't run, e.g. api not ready yet) — the element's stored height may
      // not match the image yet, and contain never crops, just letterboxes in that case.
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  );
}

// Fallback size (TikTok's own long-documented default embed card dimensions — the player
// chrome plus its like/comment/share icon column) for a freshly-inserted embeddable, before
// TiktokThumbnail's own load-time height correction kicks in once the thumbnail has loaded.
const TIKTOK_EMBED_FALLBACK_WIDTH = 340;
const TIKTOK_EMBED_FALLBACK_HEIGHT = 605;

/** Inserts a correctly-linked TikTok embeddable at the current viewport's center — bypassing
 * Excalidraw's own paste handling, which has no TikTok-specific pattern and would otherwise
 * misparse the pasted embed code's first `<a href>` (the author's profile link) as the link
 * (see parseTiktokEmbedCode). Placed at a fixed default size; TiktokThumbnail's own container
 * correction takes over as soon as the thumbnail loads, so no oEmbed round-trip is needed
 * here just to get an initial size right. `restoreElements` (the same normalization Excalidraw
 * itself runs on `initialData`/library paste) fills in every field a hand-built partial element
 * is missing — `updateScene` on its own does not. */
async function insertTiktokEmbeddable(api: ExcalidrawImperativeAPI, videoUrl: string): Promise<void> {
  const width = TIKTOK_EMBED_FALLBACK_WIDTH;
  const height = TIKTOK_EMBED_FALLBACK_HEIGHT;

  const appState = api.getAppState();
  const zoom = appState.zoom.value;
  const sceneX = appState.width / 2 / zoom - appState.scrollX - width / 2;
  const sceneY = appState.height / 2 / zoom - appState.scrollY - height / 2;
  const [restored] = restoreElements(
    [{ type: "embeddable", x: sceneX, y: sceneY, width, height, link: videoUrl }] as ExcalidrawElement[],
    null
  );
  api.updateScene({
    elements: [...api.getSceneElements(), restored],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Inserts a brand new markdown block's embeddable centered on `sceneX`/`sceneY` — the scene-
 * space equivalent of pasteFromClipboard's own `lastViewportPosition`-based placement, which
 * isn't reachable from outside Excalidraw's own App instance (see the pointermove tracking in
 * AnnotationOverlay below). Same restoreElements + append pattern as insertTiktokEmbeddable. */
function insertMarkdownEmbeddable(api: ExcalidrawImperativeAPI, blockId: string, sceneX: number, sceneY: number): void {
  const [restored] = restoreElements(
    [buildMarkdownElement(blockId, sceneX - MARKDOWN_TEXT_COLUMN_WIDTH / 2, sceneY - MARKDOWN_DEFAULT_HEIGHT / 2)] as ExcalidrawElement[],
    null
  );
  api.updateScene({
    elements: [...api.getSceneElements(), restored],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

export function AnnotationOverlay({
  markdownBlocks,
  scene,
  onChange,
  apiRef: externalApiRef,
  onCreateMarkdownBlock,
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
  const markdownBlocksRef = useRef(markdownBlocks);
  markdownBlocksRef.current = markdownBlocks;

  // A note that's already had a camera position saved (from a previous pan/zoom) keeps it
  // across opens instead of being auto-positioned again — see the centerOnMount prop doc.
  const shouldAutoCenter = centerOnMount && scene.appState.scrollX === undefined;

  const debouncedOnChange = useRef(
    debounce((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      onChangeRef.current(elements as unknown[], pickPersistedAppState(appState), files as Record<string, unknown>);
    }, CHANGE_DEBOUNCE_MS)
  ).current;

  // Last known pointer position over this overlay, in viewport (client) coordinates — kept
  // up to date on every pointer move so onPaste (a ClipboardEvent, which carries no coordinates
  // of its own) can still place a markdown-detected paste's new note under the cursor, mirroring
  // Excalidraw's own internal `lastViewportPosition` (not exposed via the imperative API).
  const lastPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

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

      // Keeps each markdown block's hidden search-text element (see reconcileMarkdownSearchElements)
      // positioned wherever its sticky note actually is — most importantly right after a drag/resize,
      // which is a plain Excalidraw element move this component otherwise has no other hook into.
      if (api) {
        const reconciled = reconcileMarkdownSearchElements(elements, markdownBlocksRef.current);
        if (reconciled !== elements) {
          const restored = restoreElements(reconciled as ExcalidrawElement[], null);
          api.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER });
          debouncedOnChange(restored, appState, files);
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

  // Markdown content is edited from a separate tab, not through Excalidraw's own onChange —
  // this is the hook that keeps each block's hidden search-text element (see
  // reconcileMarkdownSearchElements) re-worded whenever that happens, viewMode included (a
  // read-only note can still be searched).
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const current = api.getSceneElements();
    const reconciled = reconcileMarkdownSearchElements(current, markdownBlocks);
    if (reconciled !== current) {
      const restored = restoreElements(reconciled as ExcalidrawElement[], null);
      api.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER });
    }
  }, [apiRef, markdownBlocks]);

  const excalidrawAPI = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api;
    },
    [apiRef]
  );

  return (
    <div
      className="notegpt-annotation-overlay"
      style={{ visibility: isPositioned ? "visible" : "hidden" }}
      onPointerMove={(event) => {
        lastPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      }}
    >
      <Excalidraw
        excalidrawAPI={excalidrawAPI}
        viewModeEnabled={viewMode}
        validateEmbeddable
        renderEmbeddable={(element) => {
          const blockId = parseMarkdownElementId(element.id);
          if (blockId !== null) {
            return (
              <MarkdownEmbeddable
                key={element.id}
                elementId={element.id}
                markdown={markdownById.get(blockId) ?? ""}
                onHeightChange={handleHeightChange}
              />
            );
          }
          // Excalidraw has no built-in notion of TikTok (unlike YouTube/Vimeo/etc — see
          // getEmbedLink) and would otherwise try to iframe the plain watch-page URL directly,
          // which TikTok's frame-ancestors policy blocks — rendered as its oEmbed thumbnail
          // image instead (see TiktokThumbnail).
          const tiktokVideoId = typeof element.link === "string" ? extractTiktokVideoId(element.link) : null;
          if (tiktokVideoId !== null) {
            return <TiktokThumbnail key={element.id} element={element} apiRef={apiRef} />;
          }
          return null;
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
        onPaste={async (data) => {
          // TikTok's own "Copy embed code" HTML has no Excalidraw-recognized URL pattern (see
          // parseTiktokEmbedCode) — handled here, before Excalidraw's default paste ever sees
          // it, so it doesn't get misparsed into an embeddable linking at the author's profile
          // page instead of the video.
          const tiktok = typeof data.text === "string" ? parseTiktokEmbedCode(data.text) : null;
          if (tiktok) {
            const api = apiRef.current;
            if (api) await insertTiktokEmbeddable(api, tiktok.videoUrl);
            return false;
          }
          // Markdown-looking pasted text becomes its own note (a markdown block embeddable,
          // same as one added via the "+ Add note" tab) instead of a plain Excalidraw text
          // element — placed under the cursor rather than ensureMarkdownElements' own
          // stagger-to-the-right layout, since that's meant for backfilling blocks that have
          // no position opinion at all, not for a paste the user just aimed at a specific spot.
          const api = apiRef.current;
          if (api && onCreateMarkdownBlock && typeof data.text === "string" && looksLikeMarkdown(data.text)) {
            const pointer = lastPointerRef.current;
            const appState = api.getAppState();
            const { x: sceneX, y: sceneY } = pointer
              ? viewportCoordsToSceneCoords(pointer, appState)
              : { x: appState.width / 2 / appState.zoom.value - appState.scrollX, y: appState.height / 2 / appState.zoom.value - appState.scrollY };
            const blockId = onCreateMarkdownBlock(data.text);
            insertMarkdownEmbeddable(api, blockId, sceneX, sceneY);
            return false;
          }
          // See the paste-correction block in handleExcalidrawChange for why this only sets a
          // flag instead of touching appState/elements here.
          justPastedRef.current = true;
          return true;
        }}
        initialData={{
          elements: reconcileMarkdownSearchElements(
            ensureMarkdownElements(scene.elements, markdownBlocks.map((b) => b.id)),
            markdownBlocks
          ) as ExcalidrawElement[],
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
