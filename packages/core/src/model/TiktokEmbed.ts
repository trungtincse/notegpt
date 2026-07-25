/**
 * Parses the video id + canonical watch URL out of TikTok's own "Embed video" HTML snippet —
 * a `<blockquote class="tiktok-embed" cite="..." data-video-id="...">` plus a trailing
 * `<script>` tag. Excalidraw's generic-embed paste parser has no TikTok-specific pattern, so
 * it falls back to grabbing the first `href` it finds inside the blockquote — which is the
 * author's profile link (`<a href=".../video/...?refer=embed">@user</a>`), not the video
 * itself. This must run before Excalidraw ever sees the pasted text (see AnnotationOverlay's
 * onPaste) so it can be handled correctly instead.
 */
export function parseTiktokEmbedCode(html: string): { videoId: string; videoUrl: string } | null {
  if (!/class=["']tiktok-embed["']/i.test(html)) return null;
  const idMatch = html.match(/data-video-id=["'](\d+)["']/i);
  const citeMatch = html.match(/\bcite=["']([^"']+)["']/i);
  if (!idMatch || !citeMatch) return null;
  return { videoId: idMatch[1], videoUrl: citeMatch[1] };
}

/** Extracts the numeric video id from a plain TikTok video URL (`.../@user/video/<id>`,
 * with or without query params/protocol/www). Null for anything else — profile/hashtag
 * links, or a `vm.tiktok.com` short link, which has no id in the URL itself and would need a
 * network redirect to resolve one. */
export function extractTiktokVideoId(link: string): string | null {
  const match = link.match(/tiktok\.com\/@[^/?#]+\/video\/(\d+)/i);
  return match ? match[1] : null;
}

/** TikTok's own lightweight iframe-embeddable endpoint. A plain watch-page URL can't be used
 * as an iframe src — TikTok's frame-ancestors policy blocks it — but `/embed/v2/<id>` is the
 * one URL shape TikTok does allow inside an iframe, and is what the live canvas view (see
 * AnnotationOverlay's renderEmbeddable) actually points at. */
export function getTiktokEmbedSrc(videoId: string): string {
  return `https://www.tiktok.com/embed/v2/${videoId}`;
}

interface EmbeddableElementLike {
  type?: unknown;
  link?: unknown;
  isDeleted?: unknown;
}

const OEMBED_FETCH_TIMEOUT_MS = 4000;

export interface TiktokOEmbedInfo {
  thumbnailUrl: string;
  /** TikTok's oEmbed response always reports these as the literal string `"100%"`, never an
   * actual pixel size (confirmed against the live endpoint) — so this is realistically always
   * undefined. Kept optional rather than dropped outright in case that ever changes; callers
   * needing a real embed size (see AnnotationOverlay's insertTiktokEmbeddable) must fall back
   * to a hardcoded default regardless. */
  width?: number;
  height?: number;
}

/** Unlike YouTube, TikTok has no predictable static thumbnail CDN URL — the only way to get
 * one is TikTok's own oEmbed endpoint, which has to be called over the network. Used both to
 * (best-effort) size a freshly-pasted embeddable (see AnnotationOverlay's
 * insertTiktokEmbeddable) and, at print time, to get a thumbnail (see
 * replaceTiktokEmbedsForPrint below) — that latter use only needs `thumbnailUrl`, so success
 * here must not be gated on width/height parsing as numbers (see TiktokOEmbedInfo's comment).
 * Times out quickly (well under exportPdf.ts's own PRINT_READY_TIMEOUT_MS) so a slow/offline
 * network doesn't eat the whole export's time budget; returns null on any failure. */
export async function fetchTiktokOEmbed(videoUrl: string): Promise<TiktokOEmbedInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OEMBED_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const { thumbnail_url: thumbnailUrl, width, height } = data as Record<string, unknown>;
    if (typeof thumbnailUrl !== "string") return null;
    const numericWidth = Number(width);
    const numericHeight = Number(height);
    return {
      thumbnailUrl,
      width: Number.isFinite(numericWidth) ? numericWidth : undefined,
      height: Number.isFinite(numericHeight) ? numericHeight : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Swaps every canvas TikTok embeddable for a static thumbnail image before printing to PDF —
 * the print counterpart to replaceYoutubeEmbedsForPrint (same rationale: a hidden print
 * window's iframe can't be relied on to paint, and its content isn't clickable in a PDF
 * viewer regardless). A video whose thumbnail fetch fails (offline, TikTok API hiccup, or a
 * `vm.tiktok.com` short link where no id could be resolved in the first place) is left
 * unchanged rather than swapped to a broken image.
 */
export async function replaceTiktokEmbedsForPrint(
  elements: unknown[],
  files: Record<string, unknown>
): Promise<{ elements: unknown[]; files: Record<string, unknown> }> {
  const nextFiles = { ...files };
  const nextElements = await Promise.all(
    elements.map(async (element) => {
      const el = element as EmbeddableElementLike;
      if (el.isDeleted || el.type !== "embeddable" || typeof el.link !== "string") return element;
      const videoId = extractTiktokVideoId(el.link);
      if (!videoId) return element;

      const oEmbed = await fetchTiktokOEmbed(el.link);
      if (!oEmbed) return element;

      const fileId = `notegpt-tiktok-thumb:${videoId}`;
      nextFiles[fileId] = { id: fileId, mimeType: "image/jpeg", dataURL: oEmbed.thumbnailUrl, created: 0 };
      return { ...(element as Record<string, unknown>), type: "image", fileId };
    })
  );
  return { elements: nextElements, files: nextFiles };
}
