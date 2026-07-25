import { NOTE_SCHEMA_VERSION, type Note } from "./Note.js";
import { migrateMdNoteFile } from "./migrations.js";
import { mdNoteFileSchema } from "../validation/schemas.js";

export interface MdNoteFile {
  schemaVersion: number;
  note: Note;
}

export function serializeMdNote(note: Note): string {
  const file: MdNoteFile = { schemaVersion: NOTE_SCHEMA_VERSION, note };
  mdNoteFileSchema.parse(file);
  return JSON.stringify(file, null, 2);
}

/** Old-shape files (schemaVersion 1) are migrated in-memory on read — the file on disk
 * stays whatever version it was until the app next calls serializeMdNote/saveNote. */
export function deserializeMdNote(raw: string): Note {
  const parsed: unknown = JSON.parse(raw);
  const file = mdNoteFileSchema.parse(parsed);
  return migrateMdNoteFile(file);
}
