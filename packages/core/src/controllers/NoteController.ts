import { nanoid } from "nanoid";
import { createEmptyAnnotationScene } from "../model/AnnotationScene.js";
import { NOTE_SCHEMA_VERSION, type Note } from "../model/Note.js";
import type { StorageAdapter } from "../model/StorageAdapter.js";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface NoteControllerState {
  note: Note | null;
  saveStatus: SaveStatus;
}

type Listener = (state: NoteControllerState) => void;

const AUTOSAVE_DELAY_MS = 500;

export class NoteController {
  private state: NoteControllerState = { note: null, saveStatus: "idle" };
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storage: StorageAdapter) {}

  getState(): NoteControllerState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(id: string): Promise<void> {
    const note = await this.storage.loadNote(id);
    note.annotation = await this.storage.resolveAssetsForRead(note.annotation);
    this.setState({ note, saveStatus: "idle" });
  }

  async createNew(title: string): Promise<Note> {
    const note = await this.storage.createNote({ title });
    this.setState({ note, saveStatus: "idle" });
    return note;
  }

  updateMarkdown(markdown: string): void {
    if (!this.state.note) return;
    const note: Note = { ...this.state.note, markdown, updatedAt: new Date().toISOString() };
    this.setState({ note, saveStatus: "dirty" });
    this.scheduleSave();
  }

  updateAnnotation(annotation: Note["annotation"]): void {
    if (!this.state.note) return;
    const note: Note = { ...this.state.note, annotation, updatedAt: new Date().toISOString() };
    this.setState({ note, saveStatus: "dirty" });
    this.scheduleSave();
  }

  /**
   * Throttled, not debounced: the first change arms a fixed-delay timer and later
   * changes within that window don't push it back. Excalidraw's onChange can fire
   * continuously (internal appState churn, not just user edits) — a reset-on-every-call
   * debounce would let that starve autosave indefinitely.
   */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, AUTOSAVE_DELAY_MS);
  }

  async save(): Promise<void> {
    if (!this.state.note) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.setState({ note: this.state.note, saveStatus: "saving" });
    try {
      const noteToPersist: Note = {
        ...this.state.note,
        annotation: await this.storage.persistAssetsForWrite(this.state.note.annotation),
      };
      await this.storage.saveNote(noteToPersist);
      this.setState({ note: this.state.note, saveStatus: "saved" });
    } catch (error) {
      this.setState({ note: this.state.note, saveStatus: "error" });
      throw error;
    }
  }

  /** Cancels any pending autosave. Call on unmount — an armed timer left running past
   * this controller's lifetime would still fire and persist its stale in-memory note. */
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private setState(next: NoteControllerState): void {
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }
}

export function createBlankNote(title: string): Note {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    title,
    markdown: "",
    annotation: createEmptyAnnotationScene(),
    schemaVersion: NOTE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
}
