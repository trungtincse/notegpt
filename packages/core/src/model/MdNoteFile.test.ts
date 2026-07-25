import { describe, expect, it } from "vitest";
import { buildMarkdownElementId, LEGACY_MARKDOWN_ELEMENT_ID } from "./AnnotationScene.js";
import { createBlankNote } from "../controllers/NoteController.js";
import { deserializeMdNote, serializeMdNote } from "./MdNoteFile.js";

describe("MdNoteFile roundtrip", () => {
  it("serializes and deserializes a note without loss", () => {
    const note = createBlankNote("My Note");
    note.markdownBlocks = [{ id: "b1", markdown: "# Hello\n\nSome *text*." }];

    const raw = serializeMdNote(note);
    const restored = deserializeMdNote(raw);

    expect(restored).toEqual(note);
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeMdNote("{ not json")).toThrow();
  });
});

describe("v1 -> v2 migration", () => {
  function rawV1(overrides: { markdown?: string; elements?: unknown[] } = {}): string {
    return JSON.stringify({
      schemaVersion: 1,
      note: {
        id: "n1",
        title: "Old Note",
        markdown: overrides.markdown ?? "# Hi",
        annotation: {
          elements:
            overrides.elements ??
            [{ id: LEGACY_MARKDOWN_ELEMENT_ID, type: "embeddable", x: 10, y: 20, width: 900, height: 400, locked: true }],
          appState: {},
          files: {},
        },
        schemaVersion: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      },
    });
  }

  it("migrates a v1 note with content into a single v2 block, preserving position and unlocking it", () => {
    const note = deserializeMdNote(rawV1());

    expect(note.schemaVersion).toBe(2);
    expect(note.markdownBlocks).toHaveLength(1);
    const [block] = note.markdownBlocks;
    expect(block.markdown).toBe("# Hi");

    const [el] = note.annotation.elements as { id: string; x: number; y: number; locked?: boolean }[];
    expect(el.id).toBe(buildMarkdownElementId(block.id));
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.locked).toBeUndefined();
  });

  it("produces zero blocks and drops the legacy element for an empty v1 note", () => {
    const note = deserializeMdNote(rawV1({ markdown: "" }));

    expect(note.markdownBlocks).toEqual([]);
    expect(note.annotation.elements).toEqual([]);
  });

  it("self-heals a v1 note that never had its markdown element", () => {
    const note = deserializeMdNote(rawV1({ elements: [] }));

    expect(note.markdownBlocks).toHaveLength(1);
    const [block] = note.markdownBlocks;
    const [el] = note.annotation.elements as { id: string; locked?: boolean }[];
    expect(el.id).toBe(buildMarkdownElementId(block.id));
    // Freshly injected via ensureMarkdownElements, which sets `locked: false` explicitly
    // (draggable/resizable) — unlike the *rewritten* legacy-element case, which merely drops
    // the old `locked: true` key (see the "preserving position" test above).
    expect(el.locked).toBe(false);
  });

  it("passes v2 files through unchanged", () => {
    const note = createBlankNote("Already current");
    note.markdownBlocks = [{ id: "b1", markdown: "hi" }];
    const raw = serializeMdNote(note);

    const restored = deserializeMdNote(raw);

    expect(restored).toEqual(note);
    expect(restored.schemaVersion).toBe(2);
  });

  it("rejects an unknown schema version", () => {
    const raw = JSON.stringify({
      schemaVersion: 3,
      note: { id: "n1", title: "t", markdownBlocks: [], annotation: { elements: [], appState: {}, files: {} }, schemaVersion: 3, createdAt: "", updatedAt: "" },
    });
    expect(() => deserializeMdNote(raw)).toThrow();
  });
});
