import { z } from "zod";
import { NOTE_SCHEMA_VERSION } from "../model/Note.js";

export const annotationSceneSchema = z.object({
  elements: z.array(z.unknown()),
  appState: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.unknown()),
  paneWidth: z.number().optional(),
});

export const noteSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  markdown: z.string(),
  annotation: annotationSceneSchema,
  schemaVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mdNoteFileSchema = z.object({
  schemaVersion: z.literal(NOTE_SCHEMA_VERSION),
  note: noteSchema,
});
