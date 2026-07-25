import { describe, expect, it } from "vitest";
import {
  buildMarkdownElementId,
  ensureMarkdownElements,
  getLiveMarkdownBlockIds,
  isMarkdownElementId,
  LEGACY_MARKDOWN_ELEMENT_ID,
  MARKDOWN_TEXT_COLUMN_WIDTH,
  parseMarkdownElementId,
} from "./AnnotationScene.js";

describe("markdown element id scheme", () => {
  it("round-trips a block id through build/parse/is", () => {
    const id = buildMarkdownElementId("b1");
    expect(isMarkdownElementId(id)).toBe(true);
    expect(parseMarkdownElementId(id)).toBe("b1");
  });

  it("never mistakes the legacy singleton id for a v2 block id", () => {
    expect(isMarkdownElementId(LEGACY_MARKDOWN_ELEMENT_ID)).toBe(false);
    expect(parseMarkdownElementId(LEGACY_MARKDOWN_ELEMENT_ID)).toBeNull();
  });

  it("getLiveMarkdownBlockIds ignores non-markdown and deleted elements", () => {
    const elements = [
      { id: buildMarkdownElementId("b1"), type: "embeddable" },
      { id: "some-rectangle", type: "rectangle" },
      { id: buildMarkdownElementId("b2"), type: "embeddable", isDeleted: true },
    ];
    expect(getLiveMarkdownBlockIds(elements)).toEqual(new Set(["b1"]));
  });
});

describe("ensureMarkdownElements", () => {
  it("injects one unlocked default element at the origin for a blank scene", () => {
    const result = ensureMarkdownElements([], ["b1"]);
    expect(result).toHaveLength(1);
    const [el] = result as { id: string; x: number; y: number; locked: boolean }[];
    expect(el.id).toBe(buildMarkdownElementId("b1"));
    expect(el.x).toBe(0);
    expect(el.y).toBe(0);
    expect(el.locked).toBe(false);
  });

  it("is a no-op when the block already has a live element", () => {
    const elements = [{ id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0 }];
    const result = ensureMarkdownElements(elements, ["b1"]);
    expect(result).toBe(elements);
  });

  it("treats a deleted markdown element as not-present and injects a fresh one", () => {
    const elements = [{ id: buildMarkdownElementId("b1"), type: "embeddable", isDeleted: true }];
    const result = ensureMarkdownElements(elements, ["b1"]);
    expect(result).toHaveLength(2);
    const injected = (result as { id: string; isDeleted?: boolean }[]).find((el) => !el.isDeleted);
    expect(injected?.id).toBe(buildMarkdownElementId("b1"));
  });

  it("only injects the missing block, leaving an already-present one untouched", () => {
    const existing = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 5, y: 5 };
    const result = ensureMarkdownElements([existing], ["b1", "b2"]);
    expect(result).toHaveLength(2);
    expect((result as unknown[])[0]).toBe(existing);
    const b2 = (result as { id: string }[])[1];
    expect(b2.id).toBe(buildMarkdownElementId("b2"));
  });

  it("stages multiple missing blocks left-to-right without overlapping", () => {
    const result = ensureMarkdownElements([], ["b1", "b2"]) as { id: string; x: number }[];
    expect(result).toHaveLength(2);
    expect(result[1].x - result[0].x).toBeGreaterThanOrEqual(MARKDOWN_TEXT_COLUMN_WIDTH);
  });
});
