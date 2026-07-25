import { describe, expect, it } from "vitest";
import type { AnnotationScene } from "../model/AnnotationScene.js";
import { buildMarkdownElementId } from "../model/AnnotationScene.js";
import type { Note } from "../model/Note.js";
import type { StorageAdapter } from "../model/StorageAdapter.js";
import { createBlankNote, NoteController } from "./NoteController.js";

/** Minimal in-memory StorageAdapter — only load/save are ever exercised here. */
function fakeStorage(initial: Note): StorageAdapter {
  return {
    async listNotes() {
      return [];
    },
    async loadNote() {
      return initial;
    },
    async saveNote() {
      // no-op
    },
    async createNote() {
      return initial;
    },
    async deleteNote() {
      // no-op
    },
    async resolveAssetsForRead(scene: AnnotationScene) {
      return scene;
    },
    async persistAssetsForWrite(scene: AnnotationScene) {
      return scene;
    },
  };
}

async function loadedController(note: Note): Promise<NoteController> {
  const controller = new NoteController(fakeStorage(note));
  await controller.load(note.id);
  return controller;
}

describe("NoteController markdown blocks", () => {
  it("removeMarkdownBlock drops the block and its matching canvas element", async () => {
    const note = createBlankNote("Test");
    note.markdownBlocks = [
      { id: "b1", markdown: "one" },
      { id: "b2", markdown: "two" },
    ];
    note.annotation.elements = [
      { id: buildMarkdownElementId("b1") },
      { id: buildMarkdownElementId("b2") },
      { id: "some-freedraw" },
    ];
    const controller = await loadedController(note);

    controller.removeMarkdownBlock("b1");

    const state = controller.getState();
    expect(state.note?.markdownBlocks).toEqual([{ id: "b2", markdown: "two" }]);
    expect(state.note?.annotation.elements).toEqual([{ id: buildMarkdownElementId("b2") }, { id: "some-freedraw" }]);
    expect(state.saveStatus).toBe("dirty");
  });

  it("renameMarkdownBlock sets only the targeted block's title", async () => {
    const note = createBlankNote("Test");
    note.markdownBlocks = [
      { id: "b1", markdown: "one" },
      { id: "b2", markdown: "two" },
    ];
    const controller = await loadedController(note);

    controller.renameMarkdownBlock("b2", "Ideas");

    const { markdownBlocks } = controller.getState().note!;
    expect(markdownBlocks.find((b) => b.id === "b1")?.title).toBeUndefined();
    expect(markdownBlocks.find((b) => b.id === "b2")?.title).toBe("Ideas");
  });
});
