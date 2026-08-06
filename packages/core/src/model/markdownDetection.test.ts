import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./markdownDetection.js";

describe("looksLikeMarkdown", () => {
  it("rejects plain prose with no markdown constructs", () => {
    expect(looksLikeMarkdown("just a normal sentence pasted from somewhere")).toBe(false);
  });

  it("rejects short/empty text regardless of content", () => {
    expect(looksLikeMarkdown("")).toBe(false);
    expect(looksLikeMarkdown("# a")).toBe(false);
  });

  it("detects a heading", () => {
    expect(looksLikeMarkdown("## Section title\nsome body text")).toBe(true);
  });

  it("detects a bullet list", () => {
    expect(looksLikeMarkdown("- first item\n- second item")).toBe(true);
  });

  it("detects a numbered list", () => {
    expect(looksLikeMarkdown("1. first step\n2. second step")).toBe(true);
  });

  it("detects a blockquote", () => {
    expect(looksLikeMarkdown("> quoted text here")).toBe(true);
  });

  it("detects a fenced code block", () => {
    expect(looksLikeMarkdown("```js\nconst x = 1;\n```")).toBe(true);
  });

  it("detects a markdown link", () => {
    expect(looksLikeMarkdown("check out [this site](https://example.com) for more")).toBe(true);
  });

  it("detects a markdown image", () => {
    expect(looksLikeMarkdown("![alt text](https://example.com/img.png)")).toBe(true);
  });

  it("detects bold text", () => {
    expect(looksLikeMarkdown("this is **important** to know")).toBe(true);
  });

  it("detects a table row", () => {
    expect(looksLikeMarkdown("| a | b |\n| - | - |")).toBe(true);
  });
});
