import type { AnnotationScene } from "./AnnotationScene.js";

export const NOTE_SCHEMA_VERSION = 2;

export interface MarkdownBlock {
  /** nanoid — stable identity linking this block to its canvas embeddable (see AnnotationScene.ts). */
  id: string;
  markdown: string;
  /** User-given tab label; falls back to a positional "Note N" in the UI when unset. */
  title?: string;
}

export interface Note {
  id: string;
  title: string;
  markdownBlocks: MarkdownBlock[];
  annotation: AnnotationScene;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteSummary {
  id: string;
  title: string;
  /** Included so callers (e.g. a notes-list search box) can filter by body text without loading each note individually. */
  markdown: string;
  /** Concatenated text of the note's Excalidraw text annotations (not the full scene — that can carry embedded images), for the same reason as `markdown`. */
  annotationText: string;
  updatedAt: string;
}

/** Flattens all blocks into one string for search/snippet purposes (NoteSummary.markdown) — callers there only ever treat it as opaque text, not structured content. */
export function concatMarkdownBlocks(blocks: MarkdownBlock[]): string {
  return blocks.map((b) => b.markdown).join("\n\n");
}
