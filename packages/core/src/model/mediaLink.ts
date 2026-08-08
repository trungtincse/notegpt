const MEDIA_LINK_PREFIX = "mdnote-media://local/";

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);

/** Wraps an absolute local file path as a link value pointing at the app's own `mdnote-media:`
 * protocol (registered in the Electron main process — see main.ts) — the renderer never reads
 * the file itself or inlines its bytes; the protocol handler streams it by this path instead.
 * This is why a video/audio card breaks if its source file is moved, renamed, or the note is
 * opened on a different machine: unlike a pasted image (inlined as base64 in `files`), nothing
 * about the file itself is ever copied into the note. */
export function buildMediaLink(absolutePath: string): string {
  return `${MEDIA_LINK_PREFIX}${encodeURIComponent(absolutePath)}`;
}

/** Returns the absolute file path if `link` is one of our internal media links, else null. */
export function parseMediaLink(link: string | null | undefined): string | null {
  if (!link || !link.startsWith(MEDIA_LINK_PREFIX)) return null;
  return decodeURIComponent(link.slice(MEDIA_LINK_PREFIX.length));
}

export type MediaKind = "video" | "audio";

/** Classifies a pasted file as video, audio, or neither — prefers the browser-reported MIME
 * type (reliable for a real file paste) and falls back to the extension only when that's
 * missing or generic (e.g. some platforms report "application/octet-stream" for anything). */
export function detectMediaKind(fileName: string, mimeType: string): MediaKind | null {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  const ext = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return null;
}

/**
 * Pulls an absolute local file path out of pasted clipboard text — needed because "Copy" on a
 * file in a Linux file manager (Nautilus, Dolphin, ...) never populates
 * `ClipboardEvent.clipboardData.files` the way it reliably does on Windows/macOS; the file
 * reference only ever shows up as text, either a `text/uri-list` payload (one `file://` URI per
 * line, `#`-prefixed lines are comments per RFC 2483) or, from some apps, a bare absolute path.
 * Returns null for anything that isn't clearly a local file reference (a real URL, prose, etc.)
 * so an ordinary paste of a `/`-containing sentence doesn't get misread as a file.
 */
export function resolveLocalFilePath(clipboardText: string): string | null {
  const firstLine = clipboardText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!firstLine) return null;
  if (firstLine.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(firstLine).pathname);
    } catch {
      return null;
    }
  }
  return firstLine.startsWith("/") ? firstLine : null;
}
