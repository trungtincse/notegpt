import MarkdownIt from "markdown-it";
import { detectMediaKind, parseMediaLink } from "@notegpt/core";
import { useEffect, useMemo, useRef } from "react";

// html:false (default) escapes any raw HTML in the source instead of executing it.
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Standard markdown has no "embed audio/video" syntax of its own — CodeMirrorEditor's paste
// handler reuses image syntax (`![audio: name](mdnote-media://...)`) for a pasted local media
// file (see its own doc comment), so this swaps in a real playable <audio>/<video> element
// whenever an image's target resolves to one of our own `mdnote-media:` links, instead of
// rendering a broken <img> for it. Falls through to markdown-it's own image rendering for
// every other image (a normal picture, a remote URL, ...).
const defaultImageRule =
  markdownRenderer.renderer.rules.image ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
markdownRenderer.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const srcIndex = token.attrIndex("src");
  const src = srcIndex >= 0 ? token.attrs?.[srcIndex]?.[1] : null;
  const mediaPath = src ? parseMediaLink(src) : null;
  const mediaKind = mediaPath ? detectMediaKind(mediaPath, "") : null;
  if (!src || !mediaKind) return defaultImageRule(tokens, idx, options, env, self);
  const tag = mediaKind === "video" ? "video" : "audio";
  return `<${tag} controls src="${markdownRenderer.utils.escapeHtml(src)}"></${tag}>`;
};

export interface MarkdownPreviewProps {
  markdown: string;
  /** Live text currently typed into Excalidraw's own Ctrl+F search box (see AnnotationOverlay,
   * the only caller that ever passes this). Excalidraw's native match highlight draws on its
   * canvas, which always paints *underneath* this component's real DOM content (same root cause
   * noted for the Pen/Highlighter case in styles.css's `.notegpt-markdown-preview code` comment)
   * — so without this, a search match scrolls into view but is never actually visible. */
  searchQuery?: string;
}

/** Wraps every case-insensitive occurrence of `query` inside `container`'s rendered text with a
 * visible <mark>, walking the real DOM (not the raw HTML string) so a match that happens to
 * straddle markup, or land inside an attribute, can never corrupt the rendered structure. */
function highlightSearchMatches(container: HTMLElement, query: string): void {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) textNodes.push(node as Text);

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    pattern.lastIndex = 0;
    if (!pattern.test(text)) continue;

    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      const mark = document.createElement("mark");
      mark.textContent = match[0];
      fragment.appendChild(mark);
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}

/** Read-only rendered view of the note, shown while annotating so drawings/highlights land on the visible document rather than raw markdown syntax. */
export function MarkdownPreview({ markdown, searchQuery = "" }: MarkdownPreviewProps) {
  const html = useMemo(() => markdownRenderer.render(markdown), [markdown]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Imperatively owns the container's content (rather than dangerouslySetInnerHTML) so a
  // search-query change can re-highlight by resetting to the pristine `html` and re-walking it,
  // without needing to separately track/unwrap whatever <mark>s a previous query may have left.
  // Plain useEffect (not useLayoutEffect): the highlight pass (a full innerHTML reset plus a
  // TreeWalker/regex scan) doesn't need to block paint, and NOT blocking it matters here — a
  // layout effect runs synchronously inside the same render flush that's already reacting to a
  // keystroke in Excalidraw's search box, and doing this work on the main thread's critical path
  // for every visible card was heavy enough to make typing into that search box feel broken.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = html;
    const query = searchQuery.trim();
    if (query) highlightSearchMatches(container, query);
  }, [html, searchQuery]);

  return <div ref={containerRef} className="notegpt-markdown-preview" />;
}
