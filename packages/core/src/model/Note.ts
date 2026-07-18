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
  updatedAt: string;
}
