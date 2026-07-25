/** Mirrors Excalidraw's elements/appState/files shape without depending on the excalidraw package. */
export interface AnnotationScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

/**
 * Well-known id of the single Excalidraw `embeddable` element that hosts the rendered
 * markdown text as a real scene element (see `AnnotationOverlay`'s `renderEmbeddable`).
 * Its own x/width, in the same scene-coordinate space as hand-drawn elements, define
 * where the text column sits — consumers like PDF export use this to tell whether an
 * annotation sits under the column or extends into the margins beside it.
 */
export const MARKDOWN_ELEMENT_ID = "notegpt-markdown";

/** Matches the reading column width used across the editor UI and PDF export. */
export const MARKDOWN_TEXT_COLUMN_WIDTH = 900;

const MARKDOWN_DEFAULT_HEIGHT = 400;

// Never dereferenced — AnnotationOverlay's renderEmbeddable ignores it entirely —
// but Excalidraw's embeddable validator requires a non-empty `link` before it'll
// render the element at all.
const MARKDOWN_EMBED_LINK = "notegpt:markdown";

/**
 * Ensures `elements` contains the markdown container element, injecting a default
 * one (at the top-left, at the standard column width, locked so it can't be
 * dragged/deleted like a normal shape) for notes that don't have it yet — brand
 * new notes, or notes saved before this element existed. Elements are kept as
 * `unknown[]` (not typed against `@excalidraw/excalidraw`) so this stays usable
 * from non-React/non-Excalidraw contexts like the Electron main process.
 */
export function ensureMarkdownElement(elements: unknown[]): unknown[] {
  if ((elements as { id?: string }[]).some((el) => el.id === MARKDOWN_ELEMENT_ID)) return elements;
  const markdownElement = {
    id: MARKDOWN_ELEMENT_ID,
    type: "embeddable",
    // Centered on the scene origin, which is what a fresh canvas (scrollX/Y at
    // their default of 0) shows in the middle of the viewport.
    x: 0,
    y: 0,
    width: MARKDOWN_TEXT_COLUMN_WIDTH,
    height: MARKDOWN_DEFAULT_HEIGHT,
    link: MARKDOWN_EMBED_LINK,
    locked: true,
    // Otherwise Excalidraw's own defaults (a visible stroke/fill, same as any
    // other shape) paint a rectangle around the rendered markdown content.
    strokeColor: "transparent",
    backgroundColor: "transparent",
  };
  return [markdownElement, ...elements];
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
