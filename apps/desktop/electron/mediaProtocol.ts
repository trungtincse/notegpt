import { Readable } from "node:stream";
import { extname } from "node:path";
import { promises as fs, createReadStream } from "node:fs";
import { protocol } from "electron";

// Pasted video/audio cards reference their source file by absolute path (see
// @notegpt/core's buildMediaLink) instead of inlining it as base64 — this protocol is what
// actually turns that path back into playable bytes for a <video>/<audio> src. Registered as
// "standard" + "supportFetchAPI" so the renderer can use it exactly like a normal http(s) URL
// (relative resolution, fetch(), etc.); "stream" so large files don't have to buffer fully
// into memory first.
protocol.registerSchemesAsPrivileged([
  { scheme: "mdnote-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

/** Registers the `mdnote-media://` protocol handler — must be called once the app is ready
 * (see main.ts), separately from registerSchemesAsPrivileged above (which must instead run
 * before the app is ready). Only ever serves files at paths the renderer already obtained
 * itself from the OS clipboard (see the paste handling in AnnotationOverlay) — the same trust
 * model as this app's existing "read/write whatever .mdnote path the user picked" IPC, not a
 * new privilege boundary. Extension-whitelisted purely as a sanity check against serving an
 * unexpected file type, not as a security sandbox. */
export function registerMediaProtocolHandler(): void {
  protocol.handle("mdnote-media", async (request) => {
    let filePath: string;
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const mimeType = MIME_TYPES[extname(filePath).toLowerCase()];
    if (!mimeType) return new Response("Unsupported file type", { status: 415 });

    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      return new Response("Not found", { status: 404 });
    }

    // <video>/<audio> rely on Range requests to seek — without honoring them, scrubbing the
    // timeline on anything but a tiny file either fails outright or forces a full re-download
    // to seek at all.
    const range = request.headers.get("range");
    const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : size - 1;
      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Type": mimeType,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
        },
      });
    }

    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: { "Content-Type": mimeType, "Accept-Ranges": "bytes", "Content-Length": String(size) },
    });
  });
}
