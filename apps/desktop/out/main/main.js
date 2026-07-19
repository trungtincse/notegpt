import { join, extname } from "node:path";
import { ipcMain, dialog, screen, BrowserWindow, app, Menu } from "electron";
import { deserializeMdNote, serializeMdNote, createBlankNote } from "@notegpt/core";
import { promises } from "node:fs";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const PRINT_READY_TIMEOUT_MS = 5e3;
const SIDEBAR_WIDTH = 260;
const TEXT_COLUMN_WIDTH = 900;
const FALLBACK_PRINT_SIZE = { width: 1200 - SIDEBAR_WIDTH, height: 800 };
const CSS_PX_PER_INCH = 96;
const PAGE_HEIGHT_INCHES = 11.69;
function hasMarginAnnotation(note, fallbackWidth) {
  const annotation = note.annotation;
  const referenceWidth = FALLBACK_PRINT_SIZE.width;
  const appState = annotation.appState ?? {};
  const scrollX = typeof appState.scrollX === "number" ? appState.scrollX : 0;
  const zoom = typeof appState.zoom?.value === "number" ? appState.zoom.value : 1;
  const marginLeft = Math.max(0, (referenceWidth - TEXT_COLUMN_WIDTH) / 2);
  const columnRight = marginLeft + Math.min(TEXT_COLUMN_WIDTH, referenceWidth);
  const CLEARANCE = 1;
  const elements = annotation.elements ?? [];
  return elements.some((el) => {
    if (el.isDeleted) return false;
    const x = typeof el.x === "number" ? el.x : 0;
    const width = typeof el.width === "number" ? el.width : 0;
    const screenMinX = (x - scrollX) * zoom;
    const screenMaxX = (x + width - scrollX) * zoom;
    return screenMinX < marginLeft - CLEARANCE || screenMaxX > columnRight + CLEARANCE;
  });
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
    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("mdnote:print-ready", onReady);
      resolve();
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
        const [, mainHeight] = win?.getContentSize() ?? [FALLBACK_PRINT_SIZE.width + SIDEBAR_WIDTH, FALLBACK_PRINT_SIZE.height];
        const note = deserializeMdNote(await promises.readFile(filePath, "utf-8"));
        const fullScreenWidth = screen.getPrimaryDisplay().workAreaSize.width - SIDEBAR_WIDTH;
        const printWidth = hasMarginAnnotation(note, fullScreenWidth) ? fullScreenWidth : TEXT_COLUMN_WIDTH;
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
        await waitForPrintReady();
        const pdfBuffer = await printWin.webContents.printToPDF({
          printBackground: true,
          pageSize: { width: printWidth / CSS_PX_PER_INCH, height: PAGE_HEIGHT_INCHES },
          margins: { top: 0.4, bottom: 0.4, left: 0, right: 0 }
        });
        await promises.writeFile(saveResult.filePath, pdfBuffer);
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
const MAX_RECENT = 10;
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
const MDNOTE_EXT = ".mdnote";
function extractAnnotationText(scene) {
  return scene.elements.filter((element) => {
    if (typeof element !== "object" || element === null) return false;
    const candidate = element;
    return candidate.type === "text" && typeof candidate.text === "string";
  }).map((element) => element.text).join(" ");
}
function slugify(title) {
  const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return slug || "untitled";
}
async function uniqueFilePath(folderPath, title) {
  const base = slugify(title);
  let candidate = join(folderPath, `${base}${MDNOTE_EXT}`);
  let suffix = 1;
  while (await promises.access(candidate).then(() => true).catch(() => false)) {
    candidate = join(folderPath, `${base}-${suffix}${MDNOTE_EXT}`);
    suffix += 1;
  }
  return candidate;
}
function registerFileHandlers(getWindow) {
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
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Markdown Note", extensions: ["mdnote"] }]
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
          markdown: note.markdown,
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
}
const isDev = !app.isPackaged;
const preloadPath = join(__dirname, "../preload/preload.mjs");
const rendererIndexPath = join(__dirname, "../renderer/index.html");
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron's sandboxed preload loader can't run ESM `import` (our preload
      // bundle is .mjs); contextIsolation remains the real security boundary.
      sandbox: false
    }
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.log(`[did-fail-load] ${errorCode} ${errorDescription}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.log(`[render-process-gone] ${JSON.stringify(details)}`);
  });
  if (isDev && rendererDevUrl) {
    void mainWindow.loadURL(rendererDevUrl);
  } else {
    void mainWindow.loadFile(rendererIndexPath);
  }
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
    { role: "viewMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.whenReady().then(() => {
  registerFileHandlers(() => mainWindow);
  registerExportHandlers(() => mainWindow, { isDev, preloadPath, rendererDevUrl, rendererIndexPath });
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
