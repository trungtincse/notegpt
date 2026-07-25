const NOTE_LINK_PREFIX = "notegpt-note:";

/** Wraps an absolute .mdnote file path as a link value, so AnnotationOverlay's onLinkOpen can
 * tell "open this other note in the app" apart from a normal web URL and intercept it instead
 * of trying to open it as a real link. */
export function buildNoteLink(filePath: string): string {
  return `${NOTE_LINK_PREFIX}${encodeURIComponent(filePath)}`;
}

/** Returns the absolute file path if `link` is one of our internal note links, else null. */
export function parseNoteLink(link: string | null | undefined): string | null {
  if (!link || !link.startsWith(NOTE_LINK_PREFIX)) return null;
  return decodeURIComponent(link.slice(NOTE_LINK_PREFIX.length));
}
