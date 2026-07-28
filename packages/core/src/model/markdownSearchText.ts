/** Max characters per line before wrapping — keeps a match's `offsetX` (see
 * reconcileMarkdownSearchElements) bounded to roughly one sticky note's width instead of
 * growing unboundedly across a long paragraph, which would land Excalidraw's search
 * scroll-to-match well outside the sticky note it actually came from. */
const SEARCH_TEXT_WRAP_CHARS = 80;

/** Strips common Markdown syntax down to the words a user would actually search for —
 * approximate on purpose (this only feeds a hidden search-index text element, never
 * displayed), not a full Markdown parser. */
function stripMarkdownSyntax(markdown: string): string {
  return markdown
    .replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/(\*\*\*|___)(.*?)\1/g, "$2")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(?<!\w)(\*|_)(.*?)\1(?!\w)/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^(-{3,}|\*{3,}|_{3,})$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapParagraph(paragraph: string, maxLineChars: number): string {
  if (paragraph.length <= maxLineChars) return paragraph;
  const words = paragraph.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine === "") {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxLineChars) {
      currentLine += ` ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine !== "") lines.push(currentLine);
  return lines.join("\n");
}

/** Converts one markdown block's content into plain, word-wrapped text suitable for the
 * hidden text element reconcileMarkdownSearchElements keeps in sync — see that function's
 * doc comment for why this needs to exist at all (Excalidraw's built-in Ctrl+F search only
 * ever looks at `text`-type elements, never at markdown rendered into an embeddable). */
export function markdownToSearchableText(markdown: string): string {
  const stripped = stripMarkdownSyntax(markdown);
  return stripped
    .split("\n")
    .map((line) => wrapParagraph(line, SEARCH_TEXT_WRAP_CHARS))
    .join("\n");
}
