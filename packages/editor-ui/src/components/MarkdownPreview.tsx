import MarkdownIt from "markdown-it";
import { useMemo } from "react";

// html:false (default) escapes any raw HTML in the source instead of executing it.
const markdownRenderer = new MarkdownIt({ html: false, linkify: true, breaks: true });

export interface MarkdownPreviewProps {
  markdown: string;
}

/** Read-only rendered view of the note, shown while annotating so drawings/highlights land on the visible document rather than raw markdown syntax. */
export function MarkdownPreview({ markdown }: MarkdownPreviewProps) {
  const html = useMemo(() => markdownRenderer.render(markdown), [markdown]);

  return <div className="notegpt-markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
