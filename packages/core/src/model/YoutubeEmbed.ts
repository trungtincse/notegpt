import { buildLogoOverlayElement, YOUTUBE_LOGO_SVG } from "./PlatformLogoOverlay.js";

/** Extracts the video id from any YouTube URL shape Excalidraw's paste handler can produce
 * for a canvas embeddable — a plain watch/share link, a youtu.be short link, or the
 * `/embed/<id>` src pulled out of a pasted `<iframe>` embed snippet — or null if `link` isn't
 * a recognizable YouTube video URL (e.g. a playlist/videoseries embed, which has no single id). */
export function extractYoutubeVideoId(link: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(link) ? link : `https://${link}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m)\./, "");
  if (host === "youtu.be") {
    return url.pathname.slice(1).split("/")[0] || null;
  }
  if (host !== "youtube.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "watch") return url.searchParams.get("v");
  if (["embed", "shorts", "live"].includes(segments[0]) && segments[1] && segments[1] !== "videoseries") {
    return segments[1];
  }
  return null;
}

/** YouTube's static, always-available thumbnail for a video — no API key or network round
 * trip to YouTube's own player needed to display it. */
export function getYoutubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

/** The normal watch-page URL for a video id — unlike an `/embed/<id>` src, this is what a
 * clicked PDF link annotation should point at. */
export function getYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

interface EmbeddableElementLike {
  type?: unknown;
  link?: unknown;
  isDeleted?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
}

/**
 * Swaps every canvas YouTube embeddable for a static thumbnail image before printing to PDF.
 * Chromium's `printToPDF` doesn't reliably paint a cross-origin YouTube iframe in a hidden,
 * never-shown window (see exportPdf.ts's PRINT_READY_TIMEOUT_MS comment on that window's own
 * timing quirks), and even when it does, the iframe's content isn't something a PDF viewer can
 * click — this trades the live embed for something guaranteed to render (a plain `<img>`) and
 * a `link` (see exportPdf.ts's collectLinkRects) that actually goes somewhere useful.
 * Non-YouTube embeddables (and everything else) pass through unchanged.
 */
export function replaceYoutubeEmbedsForPrint(
  elements: unknown[],
  files: Record<string, unknown>
): { elements: unknown[]; files: Record<string, unknown> } {
  const nextFiles = { ...files };
  const nextElements = elements.flatMap((element) => {
    const el = element as EmbeddableElementLike;
    if (el.isDeleted || el.type !== "embeddable" || typeof el.link !== "string") return [element];
    const videoId = extractYoutubeVideoId(el.link);
    if (!videoId) return [element];

    const fileId = `notegpt-youtube-thumb:${videoId}`;
    nextFiles[fileId] = {
      id: fileId,
      mimeType: "image/jpeg",
      dataURL: getYoutubeThumbnailUrl(videoId),
      created: 0,
    };
    const thumbElement = { ...(element as Record<string, unknown>), type: "image", fileId, link: getYoutubeWatchUrl(videoId) };

    // Stamps the YouTube logo, centered, over the thumbnail — makes clear on a static
    // print/PDF page which image was originally a video (see buildLogoOverlayElement).
    if (typeof el.x === "number" && typeof el.y === "number" && typeof el.width === "number" && typeof el.height === "number") {
      const logoFileId = `notegpt-youtube-logo:${videoId}`;
      const { element: logoElement, file: logoFile } = buildLogoOverlayElement(
        { x: el.x, y: el.y, width: el.width, height: el.height },
        YOUTUBE_LOGO_SVG,
        logoFileId
      );
      nextFiles[logoFileId] = logoFile;
      return [thumbElement, logoElement];
    }
    return [thumbElement];
  });
  return { elements: nextElements, files: nextFiles };
}
