import { z } from "zod";

export const annotationSceneSchema = z.object({
  elements: z.array(z.unknown()),
  appState: z.record(z.string(), z.unknown()),
  files: z.record(z.string(), z.unknown()),
});

// --- v1 (frozen forever — do not edit after this ships; see migrations.ts) ---
const noteSchemaV1 = z.object({
  id: z.string().min(1),
  title: z.string(),
  markdown: z.string(),
  annotation: annotationSceneSchema,
  schemaVersion: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const mdNoteFileV1Schema = z.object({ schemaVersion: z.literal(1), note: noteSchemaV1 });

// --- v2 (current) ---
const markdownBlockSchema = z.object({
  id: z.string().min(1),
  markdown: z.string(),
  // Optional (not a v3 bump): already-persisted v2 files without a title still parse fine —
  // zod only requires presence of non-optional fields.
  title: z.string().optional(),
});
const noteSchemaV2 = z.object({
  id: z.string().min(1),
  title: z.string(),
  markdownBlocks: z.array(markdownBlockSchema),
  annotation: annotationSceneSchema,
  schemaVersion: z.literal(2),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const mdNoteFileV2Schema = z.object({ schemaVersion: z.literal(2), note: noteSchemaV2 });

/** "Latest" alias for existing external references to the current shape. */
export const noteSchema = noteSchemaV2;

export const mdNoteFileSchema = z.discriminatedUnion("schemaVersion", [mdNoteFileV1Schema, mdNoteFileV2Schema]);

export type MdNoteFileV1 = z.infer<typeof mdNoteFileV1Schema>;
export type MdNoteFileV2 = z.infer<typeof mdNoteFileV2Schema>;
