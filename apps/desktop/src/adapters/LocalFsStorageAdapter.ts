import type { AnnotationScene, CreateNoteInput, Note, NoteSummary, StorageAdapter } from "@notegpt/core";

/**
 * Local-file-backed StorageAdapter. The opaque `id` StorageAdapter methods take/return
 * is the absolute .mdnote file path for this adapter (Note.id, the stable content
 * identity, is tracked separately so saveNote can look up the right file to write to).
 */
export class LocalFsStorageAdapter implements StorageAdapter {
  private filePathByNoteId = new Map<string, string>();

  constructor(private readonly folderPath: string) {}

  async listNotes(): Promise<NoteSummary[]> {
    const entries = await window.mdnote.listNotesInFolder(this.folderPath);
    return entries.map((entry) => ({ id: entry.filePath, title: entry.title, updatedAt: entry.updatedAt }));
  }

  async loadNote(id: string): Promise<Note> {
    const note = await window.mdnote.readNote(id);
    this.filePathByNoteId.set(note.id, id);
    return note;
  }

  async saveNote(note: Note): Promise<void> {
    const filePath = this.filePathByNoteId.get(note.id);
    if (!filePath) {
      throw new Error(`No known file path for note ${note.id}; load or create it before saving.`);
    }
    await window.mdnote.writeNote(filePath, note);
  }

  async createNote(input: CreateNoteInput): Promise<Note> {
    const { filePath, note } = await window.mdnote.createNote(this.folderPath, input.title);
    this.filePathByNoteId.set(note.id, filePath);
    return note;
  }

  async deleteNote(id: string): Promise<void> {
    await window.mdnote.deleteNote(id);
  }

  /** Desktop-only escape hatch: resolves the file path (adapter id) for a note's stable content id. */
  getFilePathForNote(noteId: string): string | undefined {
    return this.filePathByNoteId.get(noteId);
  }

  async resolveAssetsForRead(scene: AnnotationScene): Promise<AnnotationScene> {
    return scene; // assets are already inline dataURLs on disk
  }

  async persistAssetsForWrite(scene: AnnotationScene): Promise<AnnotationScene> {
    return scene; // no-op: nothing to upload for local storage
  }
}
