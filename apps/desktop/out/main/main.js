import { join, extname, dirname, normalize, sep } from "node:path";
import { ipcMain, dialog, BrowserWindow, app, protocol, Menu, screen } from "electron";
import { deserializeMdNote, ensureMarkdownElements, getSceneBounds, isVisiblyRendered, extractYoutubeVideoId, getYoutubeWatchUrl, parseNoteLink, concatMarkdownBlocks, serializeMdNote, createBlankNote } from "@notegpt/core";
import { promises, createReadStream } from "node:fs";
import { PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFArray, PDFDict, PDFString } from "pdf-lib";
import { encode } from "jpeg-js";
import { inflateSync } from "node:zlib";
import { Readable } from "node:stream";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const MIN_RECOMPRESS_BYTES = 2e4;
const JPEG_QUALITY = 80;
function nameAt(dict, key) {
  try {
    return dict.lookupMaybe(PDFName.of(key), PDFName)?.asString();
  } catch {
    return void 0;
  }
}
function numberAt(dict, key) {
  try {
    return dict.lookupMaybe(PDFName.of(key), PDFNumber)?.asNumber();
  } catch {
    return void 0;
  }
}
function dictAt(dict, key) {
  try {
    return dict.lookupMaybe(PDFName.of(key), PDFDict);
  } catch {
    return void 0;
  }
}
function colorSpaceChannels(dict, key) {
  const name = nameAt(dict, key);
  if (name === "/DeviceRGB") return 3;
  if (name === "/DeviceGray") return 1;
  let arr;
  try {
    arr = dict.lookupMaybe(PDFName.of(key), PDFArray);
  } catch {
    return null;
  }
  if (!arr || arr.size() < 2) return null;
  let csName;
  try {
    csName = arr.lookupMaybe(0, PDFName)?.asString();
  } catch {
    return null;
  }
  if (csName !== "/ICCBased") return null;
  let iccStream;
  try {
    iccStream = arr.lookupMaybe(1, PDFRawStream);
  } catch {
    return null;
  }
  if (!iccStream) return null;
  const n = numberAt(iccStream.dict, "N");
  return n === 1 || n === 3 ? n : null;
}
async function recompressLargeRasterImages(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const { dict } = obj;
    if (nameAt(dict, "Subtype") !== "/Image") continue;
    if (nameAt(dict, "Filter") !== "/FlateDecode") continue;
    if (obj.getContentsSize() < MIN_RECOMPRESS_BYTES) continue;
    const width = numberAt(dict, "Width");
    const height = numberAt(dict, "Height");
    const bitsPerComponent = numberAt(dict, "BitsPerComponent");
    if (!width || !height || bitsPerComponent !== 8) continue;
    const channels = colorSpaceChannels(dict, "ColorSpace");
    if (channels === null) continue;
    const decodeParms = dictAt(dict, "DecodeParms");
    const predictor = decodeParms ? numberAt(decodeParms, "Predictor") : void 0;
    if (predictor && predictor > 1) continue;
    let raw;
    try {
      raw = inflateSync(Buffer.from(obj.getContents()));
    } catch {
      continue;
    }
    if (raw.length < width * height * channels) continue;
    const rgba = Buffer.alloc(width * height * 4);
    for (let i = 0, p = 0; i < width * height; i++, p += channels) {
      const r = raw[p];
      const g = channels === 3 ? raw[p + 1] : r;
      const b = channels === 3 ? raw[p + 2] : r;
      const o = i * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
    let jpegBytes;
    try {
      jpegBytes = encode({ data: rgba, width, height }, JPEG_QUALITY).data;
    } catch {
      continue;
    }
    if (jpegBytes.length >= obj.getContentsSize()) continue;
    dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
    dict.delete(PDFName.of("DecodeParms"));
    obj.contents = jpegBytes;
  }
  return pdfDoc.save();
}
const PRINT_READY_TIMEOUT_MS = 8e3;
const FALLBACK_WINDOW_HEIGHT = 800;
const CONTENT_PADDING = 150;
const CSS_PX_PER_INCH = 96;
function getPrintSceneDimensions(note) {
  const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
  const { minX, minY, maxX, maxY } = getSceneBounds(elements.filter(isVisiblyRendered));
  return {
    minX,
    minY,
    width: Math.ceil(maxX - minX) + CONTENT_PADDING * 2,
    height: Math.ceil(maxY - minY) + CONTENT_PADDING * 2
  };
}
function isExternalLink(link) {
  return typeof link === "string" && /^https?:\/\//.test(link) && parseNoteLink(link) === null;
}
function collectLinkRects(note, titleBlockHeightPx) {
  const elements = ensureMarkdownElements(note.annotation.elements, note.markdownBlocks.map((b) => b.id));
  const { minX, minY } = getSceneBounds(elements.filter(isVisiblyRendered));
  const rects = [];
  for (const el of elements) {
    if (el.isDeleted || !isExternalLink(el.link)) continue;
    const videoId = extractYoutubeVideoId(el.link);
    const url = videoId !== null ? getYoutubeWatchUrl(videoId) : el.link;
    const x = typeof el.x === "number" ? el.x : 0;
    const y = typeof el.y === "number" ? el.y : 0;
    const width = typeof el.width === "number" ? el.width : 0;
    const height = typeof el.height === "number" ? el.height : 0;
    rects.push({
      url,
      xPx: x - minX + CONTENT_PADDING,
      yPx: y - minY + CONTENT_PADDING + titleBlockHeightPx,
      widthPx: width,
      heightPx: height
    });
  }
  return rects;
}
const POINTS_PER_CSS_PX = 72 / CSS_PX_PER_INCH;
async function addLinkAnnotations(pdfBytes, links, marginTopIn) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const page = pdfDoc.getPage(0);
  const pageHeightPt = page.getHeight();
  const marginTopPt = marginTopIn * 72;
  for (const link of links) {
    const xPt = link.xPx * POINTS_PER_CSS_PX;
    const topYPt = pageHeightPt - marginTopPt - link.yPx * POINTS_PER_CSS_PX;
    const bottomYPt = topYPt - link.heightPx * POINTS_PER_CSS_PX;
    const widthPt = link.widthPx * POINTS_PER_CSS_PX;
    const annotation = pdfDoc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [xPt, bottomYPt, xPt + widthPt, topYPt],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(link.url)
      }
    });
    const annotationRef = pdfDoc.context.register(annotation);
    const existingAnnots = page.node.Annots();
    if (existingAnnots) {
      existingAnnots.push(annotationRef);
    } else {
      page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([annotationRef]));
    }
  }
  return Buffer.from(await pdfDoc.save());
}
function buildPrintUrl(folderPath, filePath, options) {
  const query = { print: "1", folder: folderPath, file: filePath };
  if (options.isDev && options.rendererDevUrl) {
    const url = new URL(options.rendererDevUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return { devUrl: url.toString() };
  }
  return { query };
}
function waitForPrintReady() {
  return new Promise((resolve) => {
    let settled = false;
    const onReady = (_event, contentHeight) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(contentHeight);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("mdnote:print-ready", onReady);
      resolve(null);
    }, PRINT_READY_TIMEOUT_MS);
    ipcMain.once("mdnote:print-ready", onReady);
  });
}
function registerExportHandlers(getWindow, options) {
  let exportInFlight = false;
  ipcMain.handle(
    "mdnote:exportNotePdf",
    async (_event, folderPath, filePath, suggestedTitle) => {
      if (exportInFlight) return null;
      exportInFlight = true;
      let printWin = null;
      try {
        const win = getWindow();
        const saveDialogOptions = {
          defaultPath: `${suggestedTitle}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }]
        };
        const saveResult = win ? await dialog.showSaveDialog(win, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
        if (saveResult.canceled || !saveResult.filePath) return null;
        const [, mainHeight] = win?.getContentSize() ?? [0, FALLBACK_WINDOW_HEIGHT];
        const note = deserializeMdNote(await promises.readFile(filePath, "utf-8"));
        const printDimensions = getPrintSceneDimensions(note);
        const printWidth = printDimensions.width;
        printWin = new BrowserWindow({
          show: false,
          width: printWidth,
          height: mainHeight,
          webPreferences: {
            preload: options.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            // Excalidraw's canvas paints via requestAnimationFrame, which Chromium
            // throttles for backgrounded windows — a window that's never shown risks
            // never getting past its first paint without this.
            backgroundThrottling: false
          }
        });
        const { devUrl, query } = buildPrintUrl(folderPath, filePath, options);
        if (devUrl) {
          await printWin.loadURL(devUrl);
        } else {
          await printWin.loadFile(options.rendererIndexPath, { query });
        }
        const contentHeight = await waitForPrintReady();
        const marginTopIn = 0.4;
        const marginBottomIn = 0.4;
        const pageHeightIn = (contentHeight ?? mainHeight) / CSS_PX_PER_INCH + marginTopIn + marginBottomIn;
        const rawPdfBuffer = await printWin.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: printWidth / CSS_PX_PER_INCH, height: pageHeightIn },
          margins: { top: marginTopIn, bottom: marginBottomIn, left: 0, right: 0 }
        });
        const pdfBuffer = await recompressLargeRasterImages(rawPdfBuffer);
        let finalBuffer = pdfBuffer;
        if (contentHeight !== null) {
          const titleBlockHeightPx = Math.max(0, contentHeight - printDimensions.height);
          const linkRects = collectLinkRects(note, titleBlockHeightPx);
          if (linkRects.length > 0) {
            finalBuffer = await addLinkAnnotations(pdfBuffer, linkRects, marginTopIn);
          }
        }
        await promises.writeFile(saveResult.filePath, finalBuffer);
        return saveResult.filePath;
      } finally {
        printWin?.destroy();
        exportInFlight = false;
      }
    }
  );
}
function pinnedNotesPath() {
  return join(app.getPath("userData"), "pinned-notes.json");
}
async function getPinnedFiles() {
  try {
    const raw = await promises.readFile(pinnedNotesPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
async function togglePinnedFile(filePath) {
  const existing = await getPinnedFiles();
  const next = existing.includes(filePath) ? existing.filter((entry) => entry !== filePath) : [filePath, ...existing];
  await promises.writeFile(pinnedNotesPath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}
async function removePinnedFile(filePath) {
  const existing = await getPinnedFiles();
  if (!existing.includes(filePath)) return;
  await promises.writeFile(
    pinnedNotesPath(),
    JSON.stringify(
      existing.filter((entry) => entry !== filePath),
      null,
      2
    ),
    "utf-8"
  );
}
async function renamePinnedFile(oldPath, newPath) {
  const existing = await getPinnedFiles();
  if (!existing.includes(oldPath)) return;
  const next = existing.map((entry) => entry === oldPath ? newPath : entry);
  await promises.writeFile(pinnedNotesPath(), JSON.stringify(next, null, 2), "utf-8");
}
const MAX_RECENT = 3;
function recentFilesPath() {
  return join(app.getPath("userData"), "recent-files.json");
}
async function getRecentFiles() {
  try {
    const raw = await promises.readFile(recentFilesPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
async function addRecentFile(filePath) {
  const existing = await getRecentFiles();
  const next = [filePath, ...existing.filter((entry) => entry !== filePath)].slice(0, MAX_RECENT);
  await promises.writeFile(recentFilesPath(), JSON.stringify(next, null, 2), "utf-8");
}
async function removeRecentFile(filePath) {
  const existing = await getRecentFiles();
  if (!existing.includes(filePath)) return;
  await promises.writeFile(
    recentFilesPath(),
    JSON.stringify(
      existing.filter((entry) => entry !== filePath),
      null,
      2
    ),
    "utf-8"
  );
}
async function renameRecentFile(oldPath, newPath) {
  const existing = await getRecentFiles();
  if (!existing.includes(oldPath)) return;
  const next = existing.map((entry) => entry === oldPath ? newPath : entry);
  await promises.writeFile(recentFilesPath(), JSON.stringify(next, null, 2), "utf-8");
}
function settingsPath() {
  return join(app.getPath("userData"), "settings.json");
}
async function readSettings() {
  try {
    const raw = await promises.readFile(settingsPath(), "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
async function getLastFolder() {
  const settings = await readSettings();
  return typeof settings.lastFolder === "string" ? settings.lastFolder : null;
}
async function setLastFolder(folderPath) {
  const settings = await readSettings();
  settings.lastFolder = folderPath;
  await promises.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}
async function getHasSeenWelcome() {
  const settings = await readSettings();
  return settings.hasSeenWelcome === true;
}
async function markWelcomeSeen() {
  const settings = await readSettings();
  settings.hasSeenWelcome = true;
  await promises.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}
const MDNOTE_EXT = ".mdnote";
const BUNDLED_WELCOME_NOTE_PATH = join(__dirname, "../../resources/welcome.mdnote");
function extractAnnotationText(scene) {
  return scene.elements.filter((element) => {
    if (typeof element !== "object" || element === null) return false;
    const candidate = element;
    return candidate.type === "text" && typeof candidate.text === "string";
  }).map((element) => element.text).join(" ");
}
function slugify(title) {
  const slug = title.trim().toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "untitled";
}
async function uniqueFilePath(folderPath, title, excludePath) {
  const base = slugify(title);
  let candidate = join(folderPath, `${base}${MDNOTE_EXT}`);
  let suffix = 1;
  while (candidate !== excludePath && await promises.access(candidate).then(() => true).catch(() => false)) {
    candidate = join(folderPath, `${base}-${suffix}${MDNOTE_EXT}`);
    suffix += 1;
  }
  return candidate;
}
function registerFileHandlers(getWindow, openNoteInNewWindow) {
  ipcMain.handle("mdnote:pickFolder", async () => {
    const win = getWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    await setLastFolder(folderPath);
    return folderPath;
  });
  ipcMain.handle("mdnote:pickMdnoteFile", async () => {
    const win = getWindow();
    if (!win) return null;
    const lastFolder = await getLastFolder();
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Markdown Note", extensions: ["mdnote"] }],
      ...lastFolder ? { defaultPath: lastFolder } : {}
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("mdnote:listNotesInFolder", async (_event, folderPath) => {
    const entries = await promises.readdir(folderPath, { withFileTypes: true });
    const mdnoteFiles = entries.filter((entry) => entry.isFile() && extname(entry.name) === MDNOTE_EXT);
    const summaries = [];
    for (const entry of mdnoteFiles) {
      const filePath = join(folderPath, entry.name);
      try {
        const raw = await promises.readFile(filePath, "utf-8");
        const note = deserializeMdNote(raw);
        summaries.push({
          filePath,
          title: note.title,
          markdown: concatMarkdownBlocks(note.markdownBlocks),
          annotationText: extractAnnotationText(note.annotation),
          updatedAt: note.updatedAt
        });
      } catch {
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });
  ipcMain.handle("mdnote:readNote", async (_event, filePath) => {
    const raw = await promises.readFile(filePath, "utf-8");
    const note = deserializeMdNote(raw);
    await addRecentFile(filePath);
    return note;
  });
  ipcMain.handle("mdnote:writeNote", async (_event, filePath, note) => {
    const raw = serializeMdNote(note);
    await promises.writeFile(filePath, raw, "utf-8");
  });
  ipcMain.handle(
    "mdnote:createNote",
    async (_event, folderPath, title) => {
      const note = createBlankNote(title);
      const filePath = await uniqueFilePath(folderPath, title);
      await promises.writeFile(filePath, serializeMdNote(note), "utf-8");
      await addRecentFile(filePath);
      return { filePath, note };
    }
  );
  ipcMain.handle("mdnote:renameNoteFile", async (_event, filePath, title) => {
    const raw = await promises.readFile(filePath, "utf-8");
    const note = deserializeMdNote(raw);
    const folderPath = dirname(filePath);
    const newFilePath = await uniqueFilePath(folderPath, title, filePath);
    const updated = { ...note, title, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await promises.writeFile(newFilePath, serializeMdNote(updated), "utf-8");
    if (newFilePath !== filePath) {
      await promises.unlink(filePath);
      await renamePinnedFile(filePath, newFilePath);
      await renameRecentFile(filePath, newFilePath);
    }
    return newFilePath;
  });
  ipcMain.handle("mdnote:deleteNote", async (_event, filePath) => {
    await promises.unlink(filePath);
    await removeRecentFile(filePath);
    await removePinnedFile(filePath);
  });
  ipcMain.handle("mdnote:getRecentFiles", async () => getRecentFiles());
  ipcMain.handle("mdnote:addRecentFile", async (_event, filePath) => addRecentFile(filePath));
  ipcMain.handle("mdnote:getPinnedFiles", async () => getPinnedFiles());
  ipcMain.handle("mdnote:togglePinnedFile", async (_event, filePath) => togglePinnedFile(filePath));
  ipcMain.handle("mdnote:getLastFolder", async () => getLastFolder());
  ipcMain.handle("mdnote:getHasSeenWelcome", async () => getHasSeenWelcome());
  ipcMain.handle("mdnote:markWelcomeSeen", async () => markWelcomeSeen());
  ipcMain.handle("mdnote:openNoteInNewWindow", async (_event, filePath) => {
    openNoteInNewWindow(filePath);
  });
  ipcMain.handle("mdnote:ensureWelcomeNoteFile", async () => {
    const filePath = join(app.getPath("userData"), `welcome${MDNOTE_EXT}`);
    const exists = await promises.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
      const seedRaw = await promises.readFile(BUNDLED_WELCOME_NOTE_PATH, "utf-8");
      await promises.writeFile(filePath, seedRaw, "utf-8");
    }
    return filePath;
  });
}
protocol.registerSchemesAsPrivileged([
  { scheme: "mdnote-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);
const MIME_TYPES$1 = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac"
};
function registerMediaProtocolHandler() {
  protocol.handle("mdnote-media", async (request) => {
    let filePath;
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ""));
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const mimeType = MIME_TYPES$1[extname(filePath).toLowerCase()];
    if (!mimeType) return new Response("Unsupported file type", { status: 415 });
    let size;
    try {
      size = (await promises.stat(filePath)).size;
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const range = request.headers.get("range");
    const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : size - 1;
      const stream2 = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream2), {
        status: 206,
        headers: {
          "Content-Type": mimeType,
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1)
        }
      });
    }
    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream), {
      status: 200,
      headers: { "Content-Type": mimeType, "Accept-Ranges": "bytes", "Content-Length": String(size) }
    });
  });
}
const MIME_TYPES = {
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
  ".map": "application/json; charset=utf-8"
};
function startRendererServer(rendererDir) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
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
        close: () => server.close()
      });
    });
  });
}
app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
app.commandLine.appendSwitch("disable-namespace-sandbox");
app.commandLine.appendSwitch("no-zygote");
const isDev = !app.isPackaged;
const preloadPath = join(__dirname, "../preload/preload.mjs");
const rendererIndexPath = join(__dirname, "../renderer/index.html");
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow = null;
let rendererServerBaseUrl = null;
function createWindow(openNotePath) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron's sandboxed preload loader can't run ESM `import` (our preload
      // bundle is .mjs); contextIsolation remains the real security boundary.
      sandbox: false
    }
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.log(`[did-fail-load] ${errorCode} ${errorDescription}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.log(`[render-process-gone] ${JSON.stringify(details)}`);
  });
  if (isDev && rendererDevUrl) {
    const url = new URL(rendererDevUrl);
    if (openNotePath) url.searchParams.set("openNote", openNotePath);
    void win.loadURL(url.toString());
  } else if (rendererServerBaseUrl) {
    const url = new URL("index.html", rendererServerBaseUrl);
    if (openNotePath) url.searchParams.set("openNote", openNotePath);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(rendererIndexPath, openNotePath ? { search: `openNote=${encodeURIComponent(openNotePath)}` } : void 0);
  }
  win.once("ready-to-show", () => {
    win.show();
  });
  return win;
}
function createMainWindow() {
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => mainWindow?.webContents.send("mdnote:menu-open-folder") },
        { label: "New Note", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.send("mdnote:menu-new-note") },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Guideline", click: () => mainWindow?.webContents.send("mdnote:menu-show-guideline") }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(async () => {
  if (!isDev) {
    try {
      const server = await startRendererServer(dirname(rendererIndexPath));
      rendererServerBaseUrl = server.baseUrl;
    } catch (err) {
      console.log(`[rendererServer] failed to start, falling back to loadFile: ${err}`);
    }
  }
  registerMediaProtocolHandler();
  registerFileHandlers(() => mainWindow, (filePath) => createWindow(filePath));
  registerExportHandlers(() => mainWindow, { isDev, preloadPath, rendererDevUrl, rendererIndexPath });
  buildMenu();
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
