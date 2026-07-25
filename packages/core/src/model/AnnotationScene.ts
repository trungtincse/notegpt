/** Mirrors Excalidraw's elements/appState/files shape without depending on the excalidraw package. */
export interface AnnotationScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * @deprecated v1-only. A Note used to carry exactly one markdown document, rendered as a
 * single embeddable element with this fixed id. Retained solely so migrations.ts can find
 * and rewrite that legacy element when migrating a v1 note — never produced by current code.
 */
export const LEGACY_MARKDOWN_ELEMENT_ID = "notegpt-markdown";

const MARKDOWN_ELEMENT_ID_PREFIX = "notegpt-markdown:";

/** Matches the reading column width used across the editor UI and PDF export. */
export const MARKDOWN_TEXT_COLUMN_WIDTH = 900;

const MARKDOWN_DEFAULT_HEIGHT = 400;

// Never dereferenced — AnnotationOverlay's renderEmbeddable ignores it entirely —
// but Excalidraw's embeddable validator requires a non-empty `link` before it'll
// render the element at all.
const MARKDOWN_EMBED_LINK = "notegpt:markdown";

/** Gap (px) between markdown blocks laid out side by side, and around the whole scene's content. */
const GUTTER = 40;

/** Builds the scene-element id for a given markdown block's canvas embeddable. */
export function buildMarkdownElementId(blockId: string): string {
  return `${MARKDOWN_ELEMENT_ID_PREFIX}${blockId}`;
}

export function isMarkdownElementId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(MARKDOWN_ELEMENT_ID_PREFIX);
}

/** Inverse of buildMarkdownElementId — null if `id` isn't a markdown block element's id. */
export function parseMarkdownElementId(id: string): string | null {
  return isMarkdownElementId(id) ? id.slice(MARKDOWN_ELEMENT_ID_PREFIX.length) : null;
}

interface IdentifiedElementLike {
  id?: unknown;
  isDeleted?: boolean;
}

/** Block ids of every non-deleted markdown embeddable currently in `elements` — the single
 * source of truth `ensureMarkdownElements` and the note controller's orphan-GC both use. */
export function getLiveMarkdownBlockIds(elements: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const el of elements as IdentifiedElementLike[]) {
    if (el.isDeleted) continue;
    if (typeof el.id === "string" && isMarkdownElementId(el.id)) ids.add(parseMarkdownElementId(el.id)!);
  }
  return ids;
}

/**
 * Ensures `elements` contains a markdown container element for each of `blockIds`, injecting
 * a default (unlocked — draggable/resizable like any other shape) one for whichever are
 * missing: brand new blocks, or notes saved before they existed. New elements stagger to the
 * right of the scene's current bounds so multiple simultaneously-missing blocks (e.g. during
 * migration) don't land stacked on top of each other. Elements are kept as `unknown[]` (not
 * typed against `@excalidraw/excalidraw`) so this stays usable from non-React/non-Excalidraw
 * contexts like the Electron main process.
 */
export function ensureMarkdownElements(elements: unknown[], blockIds: string[]): unknown[] {
  const present = getLiveMarkdownBlockIds(elements);
  const missing = blockIds.filter((id) => !present.has(id));
  if (missing.length === 0) return elements;

  const liveCount = (elements as IdentifiedElementLike[]).filter((el) => !el.isDeleted).length;
  const bounds = getSceneBounds(elements);
  const startX = liveCount > 0 ? bounds.maxX + GUTTER : 0;

  const newElements = missing.map((blockId, i) => ({
    id: buildMarkdownElementId(blockId),
    type: "embeddable",
    x: startX + i * (MARKDOWN_TEXT_COLUMN_WIDTH + GUTTER),
    y: 0,
    width: MARKDOWN_TEXT_COLUMN_WIDTH,
    height: MARKDOWN_DEFAULT_HEIGHT,
    link: MARKDOWN_EMBED_LINK,
    // Draggable/resizable like a real sticky note — unlike the old single-markdown design,
    // these are never locked.
    locked: false,
    // Otherwise Excalidraw's own defaults (a visible stroke/fill, same as any
    // other shape) paint a rectangle around the rendered markdown content.
    strokeColor: "transparent",
    backgroundColor: "transparent",
  }));
  return [...elements, ...newElements];
}

export function createEmptyAnnotationScene(): AnnotationScene {
  return { elements: [], appState: {}, files: {} };
}

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface StyledElementLike {
  type?: string;
  strokeColor?: string;
  backgroundColor?: string;
  isDeleted?: boolean;
}

/**
 * Whether `element` actually paints anything a viewer could see — a freedraw/line/rectangle
 * with both stroke and fill set to "transparent" renders nothing at all, but still has a
 * normal x/y/width/height like any other element. Meant for callers (print/PDF export) that
 * size a page around the *visible* content: an invisible leftover stroke (e.g. drawn with the
 * wrong color mid-testing, then never cleaned up) shouldn't be able to stretch the page out
 * around space nobody can see anything in. Images/embeddables/iframes/frames always count as
 * visible regardless of stroke/background, since those properties don't govern their content.
 */
export function isVisiblyRendered(element: unknown): boolean {
  const el = element as StyledElementLike;
  if (el.isDeleted) return false;
  if (el.type === "image" || el.type === "embeddable" || el.type === "iframe" || el.type === "frame") return true;
  const strokeInvisible = el.strokeColor === "transparent";
  const backgroundInvisible = !el.backgroundColor || el.backgroundColor === "transparent";
  return !(strokeInvisible && backgroundInvisible);
}

interface BoundedElementLike {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
}

/**
 * Axis-aligned bounding box across all live (non-deleted) elements, ignoring
 * rotation — good enough for sizing a print/export surface around the whole
 * scene, not a substitute for Excalidraw's own precise rendering math. Kept
 * dependency-free (no `@excalidraw/excalidraw` import) so it's safe to use
 * from the Electron main process as well as the renderer.
 */
export function getSceneBounds(elements: unknown[]): SceneBounds {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let seen = false;
  for (const el of elements as BoundedElementLike[]) {
    if (el.isDeleted) continue;
    const x = typeof el.x === "number" ? el.x : 0;
    const y = typeof el.y === "number" ? el.y : 0;
    const width = typeof el.width === "number" ? el.width : 0;
    const height = typeof el.height === "number" ? el.height : 0;
    if (!seen) {
      minX = x;
      minY = y;
      maxX = x + width;
      maxY = y + height;
      seen = true;
      continue;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return { minX, minY, maxX, maxY };
}
