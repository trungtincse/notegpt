import MarkdownIt from "markdown-it";
import { detectMediaKind, parseMediaLink } from "@notegpt/core";
import { useMemo } from "react";

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
}

/** Read-only rendered view of the note, shown while annotating so drawings/highlights land on the visible document rather than raw markdown syntax. */
export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  const html = useMemo(() => markdownRenderer.render(markdown), [markdown]);

  return <div className="notegpt-markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
