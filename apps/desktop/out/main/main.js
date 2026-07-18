import { join, extname } from "node:path";
import { app, ipcMain, dialog, BrowserWindow, Menu } from "electron";
import { deserializeMdNote, serializeMdNote, createBlankNote } from "@notegpt/core";
import { promises } from "node:fs";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
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
const MDNOTE_EXT = ".mdnote";
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
    return result.filePaths[0];
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
        summaries.push({ filePath, title: note.title, updatedAt: note.updatedAt });
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
  });
  ipcMain.handle("mdnote:getRecentFiles", async () => getRecentFiles());
  ipcMain.handle("mdnote:addRecentFile", async (_event, filePath) => addRecentFile(filePath));
}
const isDev = !app.isPackaged;
let mainWindow = null;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron's sandboxed preload loader can't run ESM `import` (our preload
      // bundle is .mjs); contextIsolation remains the real security boundary.
      sandbox: false
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
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
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
  buildMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
