import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

// YouTube's IFrame embed rejects a `file://` embedding page outright — the parent origin
// fails its own validation and the player shows "Error 153: Video player configuration
// error" instead of the video (confirmed against a real packaged build). Vite's dev server
// avoids this by serving over `http://localhost`, which YouTube accepts; this replicates that
// for the packaged app's already-built static renderer output, since `BrowserWindow.loadFile`
// has no way to serve a `file://` page over a real HTTP origin.
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

export interface RendererServer {
  /** Always ends in a trailing slash, e.g. "http://127.0.0.1:54321/". */
  baseUrl: string;
  close: () => void;
}

/** Serves `rendererDir` (the built renderer's static output directory) over a loopback-only
 * HTTP server, so the packaged app can `loadURL` a real `http://` origin instead of
 * `loadFile`'s `file://` — see this module's own comment for why that distinction actually
 * matters here. Bound to 127.0.0.1 with an OS-assigned port (never reachable off this
 * machine); only ever serves files that resolve inside `rendererDir`, guarding against a
 * request path escaping it via `..`. */
export function startRendererServer(rendererDir: string): Promise<RendererServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void (async () => {
        try {
          const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
          const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
          const filePath = normalize(join(rendererDir, relativePath));
          if (!filePath.startsWith(normalize(rendererDir) + sep) && filePath !== normalize(rendererDir)) {
            res.writeHead(403).end("Forbidden");
            return;
          }

          const contents = await readFile(filePath);
          const mimeType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
          res.writeHead(200, { "Content-Type": mimeType });
          res.end(contents);
        } catch {
          res.writeHead(404).end("Not found");
        }
      })();
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Renderer server failed to bind to a port"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: () => server.close(),
      });
    });
  });
}
