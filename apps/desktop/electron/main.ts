import { dirname, join } from "node:path";
import { app, BrowserWindow, Menu } from "electron";
import { registerExportHandlers } from "./ipc/exportPdf.js";
import { registerFileHandlers } from "./ipc/fileHandlers.js";
import { screen } from "electron";
import { startRendererServer } from "./rendererServer.js";

// Chromium's zygote/GPU process sandbox fails to spawn on some Linux kernels even when
// chrome-sandbox is present and correctly permissioned (observed: "GPU process launch
// failed", app never gets past a blank window) — must be set before app.whenReady(), and
// as a command-line switch, not webPreferences.sandbox (that only controls the renderer's
// own sandboxing, not the zygote/GPU process spawn that's actually failing).
app.commandLine.appendSwitch("no-sandbox");
// `no-sandbox` alone doesn't cover a related, separate class of Linux GPU issue: a cross-
// origin iframe (a YouTube embeddable, the one remaining live iframe in the app — TikTok's
// own embeddable renders a static thumbnail image instead, see TiktokThumbnail) needs its own
// out-of-process-iframe compositing handshake, distinct from the main renderer's. Observed in
// packaged (but not dev) builds: the iframe itself loads (Excalidraw treats it as a valid
// embed and draws its normal UI chrome around it) but never paints, showing as a flat gray
// box — the classic symptom of a restricted/misconfigured `/dev/shm` breaking the GPU
// process's shared-memory compositing buffers, which `disable-dev-shm-usage` (spill to /tmp
// instead) and `disable-gpu-sandbox` (the GPU process's own separate sandbox, not covered by
// the renderer/zygote-focused `no-sandbox` above) are the standard fix for.
app.commandLine.appendSwitch("disable-gpu-sandbox");
app.commandLine.appendSwitch("disable-dev-shm-usage");
// Confirmed via kernel audit log (`journalctl -k`) on a real Ubuntu 24.04 machine: even with
// `no-sandbox` above, Chromium still calls unshare() to create a Linux user namespace for
// unrelated internal reasons. AppArmor allows that creation but then transitions the process
// into a more restricted `unprivileged_userns` profile — audit showed
// `operation="userns_create" ... transitioning profile` immediately followed by
// `apparmor="DENIED" operation="capable" ... capability=21 capname="sys_admin"` inside that
// profile, then a hard `trap int3` crash in that process. That denial/crash is what was
// corrupting GPU shared-memory setup downstream (surfacing as a bizarre "/tmp: No such
// process" error) and leaving the YouTube embeddable's out-of-process iframe blank.
// `disable-namespace-sandbox` alone did NOT stop this (verified: identical audit sequence
// with it set) — this Electron/Chromium build's zygote calls unshare() unconditionally as
// part of its own process-launcher architecture, not gated by that flag. `no-zygote` skips
// the zygote fork-server entirely (renderer/GPU processes are forked directly instead),
// which is the only thing that actually avoids this call path.
app.commandLine.appendSwitch("disable-namespace-sandbox");
app.commandLine.appendSwitch("no-zygote");

const isDev = !app.isPackaged;
const preloadPath = join(__dirname, "../preload/preload.mjs");
const rendererIndexPath = join(__dirname, "../renderer/index.html");
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;

let mainWindow: BrowserWindow | null = null;
// Set once, before any window is created, by the rendererServer.start() call in
// app.whenReady() below — only used in production (see createWindow's isDev branch).
let rendererServerBaseUrl: string | null = null;

// Shared by the main window and any note-link-opened windows (see openNoteInNewWindow) — the
// only difference between them is which note, if any, gets auto-selected on load, passed via
// a `?openNote=` query param the renderer reads on mount (see the effect in App.tsx).
function createWindow(openNotePath?: string): BrowserWindow {
  // screen can only be used once the app is ready, so this is read here
  // (createWindow always runs inside app.whenReady()) rather than at module load.
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
      sandbox: false,
    },
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
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
    // See rendererServer.ts: a real http:// origin (not loadFile's file://) is required for
    // the YouTube embeddable to actually play instead of showing "Error 153".
    const url = new URL("index.html", rendererServerBaseUrl);
    if (openNotePath) url.searchParams.set("openNote", openNotePath);
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(rendererIndexPath, openNotePath ? { search: `openNote=${encodeURIComponent(openNotePath)}` } : undefined);
  }

  win.once("ready-to-show", () => {
    win.show();
  });

  return win;
}

function createMainWindow(): void {
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => mainWindow?.webContents.send("mdnote:menu-open-folder") },
        { label: "New Note", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.send("mdnote:menu-new-note") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Guideline", click: () => mainWindow?.webContents.send("mdnote:menu-show-guideline") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  if (!isDev) {
    try {
      const server = await startRendererServer(dirname(rendererIndexPath));
      rendererServerBaseUrl = server.baseUrl;
    } catch (err) {
      // Falls back to createWindow's loadFile branch — a broken YouTube embeddable is far
      // better than the app failing to start at all.
      console.log(`[rendererServer] failed to start, falling back to loadFile: ${err}`);
    }
  }

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
