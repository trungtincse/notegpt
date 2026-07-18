import type { AnnotationScene } from "./AnnotationScene.js";

export const NOTE_SCHEMA_VERSION = 1;

export interface Note {
  id: string;
  title: string;
  markdown: string;
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
