import { describe, expect, it } from "vitest";
import { createBlankNote } from "../controllers/NoteController.js";
import { deserializeMdNote, serializeMdNote } from "./MdNoteFile.js";

describe("MdNoteFile roundtrip", () => {
  it("serializes and deserializes a note without loss", () => {
    const note = createBlankNote("My Note");
    note.markdown = "# Hello\n\nSome *text*.";

    const raw = serializeMdNote(note);
    const restored = deserializeMdNote(raw);

    expect(restored).toEqual(note);
  });

  it("rejects malformed JSON", () => {
    expect(() => deserializeMdNote("{ not json")).toThrow();
  });
});
