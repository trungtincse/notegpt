const CARD_LINK_PREFIX = "notegpt-card:";

/** Wraps a markdown block id as a link value, so AnnotationOverlay's onLinkOpen can tell "focus
 * this card in the current note" apart from a normal web URL or a link to another note (see
 * noteLink.ts) and intercept it instead of trying to open it as a real link. */
export function buildCardLink(blockId: string): string {
  return `${CARD_LINK_PREFIX}${blockId}`;
}

/** Returns the target block id if `link` is one of our internal card links, else null. */
export function parseCardLink(link: string | null | undefined): string | null {
  if (!link || !link.startsWith(CARD_LINK_PREFIX)) return null;
  return link.slice(CARD_LINK_PREFIX.length);
}
