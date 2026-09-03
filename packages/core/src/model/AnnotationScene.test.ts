import { describe, expect, it } from "vitest";
import {
  buildMarkdownElementId,
  buildMarkdownSearchElementId,
  ensureMarkdownElements,
  getLiveMarkdownBlockIds,
  isMarkdownElementId,
  isMarkdownSearchElementId,
  isVisiblyRendered,
  LEGACY_MARKDOWN_ELEMENT_ID,
  MARKDOWN_TEXT_COLUMN_WIDTH,
  parseMarkdownElementId,
  parseMarkdownSearchElementId,
  reconcileMarkdownSearchElements,
} from "./AnnotationScene.js";

interface TextElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  isDeleted?: boolean;
}

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

describe("isVisiblyRendered", () => {
  it("is false for a freedraw stroke with transparent color (nothing to see)", () => {
    expect(isVisiblyRendered({ type: "freedraw", strokeColor: "transparent", backgroundColor: "transparent" })).toBe(false);
  });

  it("is true for a freedraw stroke with a real color", () => {
    expect(isVisiblyRendered({ type: "freedraw", strokeColor: "#ca0a0a", backgroundColor: "transparent" })).toBe(true);
  });

  it("is true for a highlighter-style rectangle (transparent stroke, real fill)", () => {
    expect(isVisiblyRendered({ type: "rectangle", strokeColor: "transparent", backgroundColor: "#ffd43b" })).toBe(true);
  });

  it("is false for a deleted (tombstoned) element regardless of color", () => {
    expect(isVisiblyRendered({ type: "freedraw", strokeColor: "#ca0a0a", isDeleted: true })).toBe(false);
  });

  it("always treats images/embeddables as visible regardless of stroke/background", () => {
    expect(isVisiblyRendered({ type: "image", strokeColor: "transparent", backgroundColor: "transparent" })).toBe(true);
    expect(isVisiblyRendered({ type: "embeddable", strokeColor: "transparent", backgroundColor: "transparent" })).toBe(true);
  });
});

describe("markdown search element id scheme", () => {
  it("round-trips a block id through build/parse/is", () => {
    const id = buildMarkdownSearchElementId("b1");
    expect(isMarkdownSearchElementId(id)).toBe(true);
    expect(parseMarkdownSearchElementId(id)).toBe("b1");
  });

  it("never mistakes a markdown embeddable's own id for a search-text id", () => {
    const id = buildMarkdownElementId("b1");
    expect(isMarkdownSearchElementId(id)).toBe(false);
    expect(parseMarkdownSearchElementId(id)).toBeNull();
  });
});

describe("reconcileMarkdownSearchElements", () => {
  it("creates a hidden search-text element positioned at its block's embeddable", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 10, y: 20, width: 900 };
    const result = reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello world" }]);
    expect(result).toHaveLength(2);
    const searchEl = (result as TextElementLike[]).find((el) => isMarkdownSearchElementId(el.id))!;
    expect(searchEl.type).toBe("text");
    expect(searchEl.x).toBe(10);
    expect(searchEl.y).toBe(20);
    expect(searchEl.text).toBe("hello world");
  });

  it("is a no-op when nothing has moved or changed", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const seeded = reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello" }]);
    const result = reconcileMarkdownSearchElements(seeded, [{ id: "b1", markdown: "hello" }]);
    expect(result).toBe(seeded);
  });

  it("repositions the search-text element after its embeddable moves (e.g. the sticky note was dragged)", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const seeded = reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello" }]);
    const moved = (seeded as { id: string }[]).map((el) => (el.id === embeddable.id ? { ...el, x: 500, y: 300 } : el));
    const result = reconcileMarkdownSearchElements(moved, [{ id: "b1", markdown: "hello" }]);
    const searchEl = (result as TextElementLike[]).find((el) => isMarkdownSearchElementId(el.id))!;
    expect(searchEl.x).toBe(500);
    expect(searchEl.y).toBe(300);
  });

  it("re-words the search-text element when the block's markdown content changes", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const seeded = reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello" }]);
    const result = reconcileMarkdownSearchElements(seeded, [{ id: "b1", markdown: "goodbye" }]);
    const searchEl = (result as TextElementLike[]).find((el) => isMarkdownSearchElementId(el.id))!;
    expect(searchEl.text).toBe("goodbye");
  });

  it("tombstones the search-text element once its block/embeddable is gone", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const seeded = reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello" }]);
    const withoutEmbeddable = (seeded as { id: string; isDeleted?: boolean }[]).map((el) =>
      el.id === embeddable.id ? { ...el, isDeleted: true } : el
    );
    const result = reconcileMarkdownSearchElements(withoutEmbeddable, []);
    const searchEl = (result as TextElementLike[]).find((el) => isMarkdownSearchElementId(el.id))!;
    expect(searchEl.isDeleted).toBe(true);
  });

  // Regression test for a real infinite-update-loop crash: a freshly-added "+ Add card" block
  // starts out with empty markdown. Excalidraw's own restore() unconditionally hard-deletes any
  // `text` element with empty content (bumping its version every time), so if this function ever
  // wrote one out, the very next reconcile would see it as deleted, consider the block "missing
  // its search element" again (deleted elements used to be excluded from that check), and create
  // a fresh empty one — forever. These pin down the fix: never create one for empty markdown,
  // and reaching a stable, unchanging result across repeated calls (the actual crash symptom was
  // this never converging).
  it("never creates a search-text element for a block with empty markdown", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const scene = [embeddable];
    const result = reconcileMarkdownSearchElements(scene, [{ id: "b1", markdown: "" }]);
    expect(result).toBe(scene);
    expect((result as TextElementLike[]).some((el) => isMarkdownSearchElementId(el.id))).toBe(false);
  });

  it("converges (stops changing) across repeated reconciles of an empty block, even starting from an already-tombstoned empty-text element", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    // Simulates the one throwaway element Excalidraw's own restore() would have hard-deleted —
    // this must settle immediately, not spawn another one.
    const staleDeletedSearchEl = { id: buildMarkdownSearchElementId("b1"), type: "text", x: 0, y: 0, text: "", isDeleted: true };
    const scene = [embeddable, staleDeletedSearchEl];
    const first = reconcileMarkdownSearchElements(scene, [{ id: "b1", markdown: "" }]);
    const second = reconcileMarkdownSearchElements(first, [{ id: "b1", markdown: "" }]);
    expect(second).toBe(first);
  });

  it("tombstones the search-text element when its block's markdown is edited down to empty", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const seeded = reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello" }]);
    const result = reconcileMarkdownSearchElements(seeded, [{ id: "b1", markdown: "" }]);
    const searchEl = (result as TextElementLike[]).find((el) => isMarkdownSearchElementId(el.id))!;
    expect(searchEl.isDeleted).toBe(true);
  });

  it("revives a tombstoned search-text element once its block has markdown again", () => {
    const embeddable = { id: buildMarkdownElementId("b1"), type: "embeddable", x: 0, y: 0, width: 900 };
    const emptied = reconcileMarkdownSearchElements(
      reconcileMarkdownSearchElements([embeddable], [{ id: "b1", markdown: "hello" }]),
      [{ id: "b1", markdown: "" }]
    );
    const result = reconcileMarkdownSearchElements(emptied, [{ id: "b1", markdown: "hello again" }]);
    const searchEl = (result as TextElementLike[]).find((el) => isMarkdownSearchElementId(el.id))!;
    expect(searchEl.isDeleted).toBe(false);
    expect(searchEl.text).toBe("hello again");
    // Must revive the existing element, not mint a second one with the same id.
    expect((result as TextElementLike[]).filter((el) => isMarkdownSearchElementId(el.id))).toHaveLength(1);
  });
});
