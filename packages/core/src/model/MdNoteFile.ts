import { NOTE_SCHEMA_VERSION, type Note } from "./Note.js";
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

export function deserializeMdNote(raw: string): Note {
  const parsed: unknown = JSON.parse(raw);
  const file = mdNoteFileSchema.parse(parsed);
  return file.note;
}
