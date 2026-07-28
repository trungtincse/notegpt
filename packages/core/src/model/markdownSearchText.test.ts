import { describe, expect, it } from "vitest";
import { markdownToSearchableText } from "./markdownSearchText.js";

describe("markdownToSearchableText", () => {
  it("strips headers, emphasis, and inline code down to plain words", () => {
    expect(markdownToSearchableText("# Title\n\nSome **bold** and *italic* and `code`.")).toBe(
      "Title\n\nSome bold and italic and code."
    );
  });

  it("keeps link and image label text, dropping the URL", () => {
    expect(markdownToSearchableText("See [the docs](https://example.com) and ![a diagram](https://example.com/x.png)")).toBe(
      "See the docs and a diagram"
    );
  });

  it("strips list/blockquote markers", () => {
    expect(markdownToSearchableText("- one\n- two\n> a quote")).toBe("one\ntwo\na quote");
  });

  it("strips fenced code blocks down to their contents", () => {
    expect(markdownToSearchableText("```ts\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("word-wraps a long paragraph instead of leaving one very long line", () => {
    const longParagraph = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const wrapped = markdownToSearchableText(longParagraph);
    const lines = wrapped.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
    // No word content was lost in the wrap.
    expect(wrapped.replace(/\n/g, " ")).toBe(longParagraph);
  });

  it("leaves a short paragraph on one line", () => {
    expect(markdownToSearchableText("hello world")).toBe("hello world");
  });
});
