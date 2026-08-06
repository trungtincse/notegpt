/** One regex per recognizable Markdown construct — headings, lists, blockquotes, fenced code,
 * links/images, bold, and table rows. Matching any single one is enough; this only gates
 * whether a paste becomes a note versus plain annotation text, not a real parse, so it's
 * deliberately permissive rather than requiring multiple corroborating signals. */
const MARKDOWN_PATTERNS: readonly RegExp[] = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+\.\s+\S/m,
  /^>\s?\S/m,
  /```/,
  /!\[[^\]]*\]\([^)]+\)/,
  /\[[^\]]+\]\([^)]+\)/,
  /\*\*[^*\n]+\*\*/,
  /^\s*\|.+\|\s*$/m,
];

/** Whether `text` reads as Markdown rather than plain prose — used to decide whether a pasted
 * clipboard string should become its own note (a markdown block embeddable) instead of a plain
 * Excalidraw text element. Anything under 4 characters is too short for any construct below to
 * mean much, so it's treated as plain text regardless of content. */
export function looksLikeMarkdown(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(trimmed));
}
