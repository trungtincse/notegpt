import { nanoid } from "nanoid";
import type { MdNoteFileV1, MdNoteFileV2 } from "../validation/schemas.js";
import { LEGACY_MARKDOWN_ELEMENT_ID, buildMarkdownElementId, ensureMarkdownElements } from "./AnnotationScene.js";
import { NOTE_SCHEMA_VERSION, type Note } from "./Note.js";

/** Entry point: takes a zod-validated (but possibly old-shape) file, returns a current-shape Note. */
export function migrateMdNoteFile(file: MdNoteFileV1 | MdNoteFileV2): Note {
  switch (file.schemaVersion) {
    case 1:
      return migrateV1ToV2(file.note);
    case 2:
      return file.note;
  }
}

function migrateV1ToV2(note: MdNoteFileV1["note"]): Note {
  const hasContent = note.markdown.trim() !== "";
  const blockId = nanoid();

  const elements = (note.annotation.elements as { id?: unknown }[]).flatMap((el) => {
    if (el.id !== LEGACY_MARKDOWN_ELEMENT_ID) return [el];
    if (!hasContent) return []; // drop: no block left for it to point at
    const { locked: _locked, ...rest } = el as { locked?: unknown };
    // Position/size preserved from the original — only the id changes (legacy singleton ->
    // per-block id scheme) and `locked` is dropped (blocks are draggable/resizable now).
    return [{ ...rest, id: buildMarkdownElementId(blockId) }];
  });

  return {
    id: note.id,
    title: note.title,
    markdownBlocks: hasContent ? [{ id: blockId, markdown: note.markdown }] : [],
    annotation: {
      ...note.annotation,
      // Self-heal: if a v1 file was ever saved without its markdown element present
      // (nothing enforced that it must be), inject a fresh default rather than silently
      // losing the block's canvas representation.
      elements: hasContent ? ensureMarkdownElements(elements, [blockId]) : elements,
    },
    schemaVersion: NOTE_SCHEMA_VERSION,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
