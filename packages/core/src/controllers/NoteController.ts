import { nanoid } from "nanoid";
import { buildMarkdownElementId, createEmptyAnnotationScene } from "../model/AnnotationScene.js";
import { NOTE_SCHEMA_VERSION, type Note } from "../model/Note.js";
import type { StorageAdapter } from "../model/StorageAdapter.js";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface NoteControllerState {
  note: Note | null;
  saveStatus: SaveStatus;
  /** Set when the most recent load() failed (e.g. the file was deleted/renamed out from under
   * a stale link) — cleared on the next successful load. Null while nothing has gone wrong. */
  loadError: string | null;
}

type Listener = (state: NoteControllerState) => void;

const AUTOSAVE_DELAY_MS = 500;

export class NoteController {
  private state: NoteControllerState = { note: null, saveStatus: "idle", loadError: null };
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

  // Deliberately never rejects: a stale link (the file got deleted or renamed out from under
  // it — see LocalFsStorageAdapter.renameNote) is an expected failure mode, not a bug to crash
  // on. Callers (see EditorShell) just check `loadError` afterward instead of try/catching.
  async load(id: string): Promise<void> {
    try {
      const note = await this.storage.loadNote(id);
      note.annotation = await this.storage.resolveAssetsForRead(note.annotation);
      this.setState({ note, saveStatus: "idle", loadError: null });
    } catch (error) {
      this.setState({ note: null, saveStatus: "idle", loadError: error instanceof Error ? error.message : String(error) });
    }
  }

  async createNew(title: string): Promise<Note> {
    const note = await this.storage.createNote({ title });
    this.setState({ note, saveStatus: "idle" });
    return note;
  }

  /** Appends a new empty block and returns its id, so the caller can also place a matching
   * embeddable on canvas (see AnnotationScene.ensureMarkdownElements). Deliberately does NOT
   * touch `annotation.elements` itself — that's the canvas's job, backfilled lazily next time
   * the annotation view mounts. */
  addMarkdownBlock(): string {
    if (!this.state.note) throw new Error("No note loaded");
    const id = nanoid();
    const note: Note = {
      ...this.state.note,
      markdownBlocks: [...this.state.note.markdownBlocks, { id, markdown: "" }],
      updatedAt: new Date().toISOString(),
    };
    this.setState({ note, saveStatus: "dirty" });
    this.scheduleSave();
    return id;
  }

  updateMarkdownBlock(blockId: string, markdown: string): void {
    if (!this.state.note) return;
    const markdownBlocks = this.state.note.markdownBlocks.map((b) => (b.id === blockId ? { ...b, markdown } : b));
    const note: Note = { ...this.state.note, markdownBlocks, updatedAt: new Date().toISOString() };
    this.setState({ note, saveStatus: "dirty" });
    this.scheduleSave();
  }

  renameMarkdownBlock(blockId: string, title: string): void {
    if (!this.state.note) return;
    const markdownBlocks = this.state.note.markdownBlocks.map((b) => (b.id === blockId ? { ...b, title } : b));
    const note: Note = { ...this.state.note, markdownBlocks, updatedAt: new Date().toISOString() };
    this.setState({ note, saveStatus: "dirty" });
    this.scheduleSave();
  }

  /** Explicit user-driven removal (e.g. a tab's close button in the Markdown view) — unlike
   * `pruneMarkdownBlocks`, this is the source of the deletion, not a reaction to one, so it
   * also drops the block's canvas embeddable itself instead of waiting for a scene diff. */
  removeMarkdownBlock(blockId: string): void {
    if (!this.state.note) return;
    const markdownBlocks = this.state.note.markdownBlocks.filter((b) => b.id !== blockId);
    const elementId = buildMarkdownElementId(blockId);
    const elements = this.state.note.annotation.elements.filter((el) => (el as { id?: unknown }).id !== elementId);
    const note: Note = {
      ...this.state.note,
      markdownBlocks,
      annotation: { ...this.state.note.annotation, elements },
      updatedAt: new Date().toISOString(),
    };
    this.setState({ note, saveStatus: "dirty" });
    this.scheduleSave();
  }

  /** Counterpart to AnnotationController's gcUnreferencedFiles, but for note-owned block
   * content: drops blocks whose matching canvas embeddable no longer exists (the user deleted
   * it). No-op-guarded so calling it on every scene update doesn't spuriously mark the note
   * dirty when nothing was actually deleted. */
  pruneMarkdownBlocks(liveBlockIds: ReadonlySet<string>): void {
    if (!this.state.note) return;
    const { markdownBlocks } = this.state.note;
    const pruned = markdownBlocks.filter((b) => liveBlockIds.has(b.id));
    if (pruned.length === markdownBlocks.length) return;
    const note: Note = { ...this.state.note, markdownBlocks: pruned, updatedAt: new Date().toISOString() };
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

  private setState(next: Partial<NoteControllerState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }
}

export function createBlankNote(title: string): Note {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    title,
    markdownBlocks: [],
    annotation: createEmptyAnnotationScene(),
    schemaVersion: NOTE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
}
