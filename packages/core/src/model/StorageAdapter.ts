import type { AnnotationScene } from "./AnnotationScene.js";
import type { Note, NoteSummary } from "./Note.js";

export interface CreateNoteInput {
  title: string;
}

/**
 * Implemented per-platform (LocalFsStorageAdapter, FirebaseStorageAdapter).
 * resolveAssetsForRead/persistAssetsForWrite let each backend normalize
 * image assets (inline dataURL vs. remote Storage URL) so the rest of the
 * app always sees plain dataURLs regardless of which adapter is active.
 */
export interface StorageAdapter {
  listNotes(): Promise<NoteSummary[]>;
  loadNote(id: string): Promise<Note>;
  saveNote(note: Note): Promise<void>;
  createNote(input: CreateNoteInput): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  resolveAssetsForRead(scene: AnnotationScene): Promise<AnnotationScene>;
  persistAssetsForWrite(scene: AnnotationScene): Promise<AnnotationScene>;
}
