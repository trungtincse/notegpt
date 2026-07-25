import type { AnnotationScene, Note, NoteSummary, StorageAdapter } from "@notegpt/core";
import { createWelcomeNote } from "../welcomeNote.js";

/**
 * Serves the bundled first-launch intro note without touching the filesystem — it's never a
 * real user file. Every mutating method is a no-op: if the user pokes around the Markdown tab
 * while exploring it, those edits simply aren't meant to persist anywhere.
 */
export class WelcomeNoteStorageAdapter implements StorageAdapter {
  async listNotes(): Promise<NoteSummary[]> {
    return [];
  }

  async loadNote(): Promise<Note> {
    return createWelcomeNote();
  }

  async saveNote(): Promise<void> {
    // no-op — see class doc
  }

  async createNote(): Promise<Note> {
    return createWelcomeNote();
  }

  async deleteNote(): Promise<void> {
    // no-op — see class doc
  }

  async resolveAssetsForRead(scene: AnnotationScene): Promise<AnnotationScene> {
    return scene;
  }

  async persistAssetsForWrite(scene: AnnotationScene): Promise<AnnotationScene> {
    return scene;
  }
}
