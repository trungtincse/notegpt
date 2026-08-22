import type { ReactNode } from "react";

export interface NoteListEntry {
  filePath: string;
  title: string;
  markdown: string;
  annotationText: string;
  updatedAt: string;
}

export interface NoteSearchResult {
  entry: NoteListEntry;
  titleMatches: boolean;
  snippet: string | null;
}

const SNIPPET_RADIUS = 40;

/** A short excerpt around the first match, so results whose title doesn't match still show *why* they matched. */
function buildSnippet(text: string, query: string): string | null {
  const index = text.toLowerCase().indexOf(query);
  if (index === -1) return null;
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Wraps every case-insensitive occurrence of `query` in `text` with <mark>, preserving the source text's original casing. */
export function highlightMatches(text: string, query: string): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(query, cursor);
  while (index !== -1) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark key={index}>{text.slice(index, index + query.length)}</mark>);
    cursor = index + query.length;
    index = lowerText.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** Matches title, full markdown, and Excalidraw annotation text — see NoteSummary's own doc
 * comment in @notegpt/core for why all three are already loaded in memory for every note as
 * soon as a folder is opened, so this never needs to touch disk. Empty for a blank query (the
 * search modal shows its own "type to search" placeholder in that case instead). */
export function computeSearchResults(notes: NoteListEntry[], trimmedQuery: string): NoteSearchResult[] {
  if (!trimmedQuery) return [];
  return notes
    .filter(
      (n) =>
        n.title.toLowerCase().includes(trimmedQuery) ||
        n.markdown.toLowerCase().includes(trimmedQuery) ||
        n.annotationText.toLowerCase().includes(trimmedQuery)
    )
    .map((entry) => {
      const titleMatches = entry.title.toLowerCase().includes(trimmedQuery);
      const snippet = titleMatches ? null : (buildSnippet(entry.markdown, trimmedQuery) ?? buildSnippet(entry.annotationText, trimmedQuery));
      return { entry, titleMatches, snippet };
    });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today"/"Yesterday" for the last two days, else "Aug 18" (or "Aug 18, 2024" once it's no
 * longer the current year) — matches the relative-date column in the search results list. */
export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / DAY_MS);
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  const includeYear = date.getFullYear() !== now.getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: includeYear ? "numeric" : undefined });
}
