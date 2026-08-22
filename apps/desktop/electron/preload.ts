import type { Note } from "@notegpt/core";
import { clipboard, contextBridge, ipcRenderer } from "electron";
import type { NoteFileSummary } from "./ipc/fileHandlers.js";

export const mdnoteApi = {
  // A file copied from a GNOME/GTK file manager (Nautilus, ...) can reach the renderer's DOM
  // `paste` event as a `File` with `clipboardData.types` reporting only "Files" — no
  // `text/uri-list`/`text/plain` at all, and Electron's usual `.path` augmentation on that File
  // also absent — even though the OS clipboard genuinely carries a `text/uri-list` target
  // (confirmed: GTK's own clipboard API sees it fine). Electron's `clipboard` module reads the
  // *native* clipboard directly rather than going through Chromium's DOM sanitization, so it can
  // recover that same payload when the DOM API can't — see CodeMirrorEditor's paste handler.
  readClipboardUriList: (): string | null => {
    if (!clipboard.availableFormats().includes("text/uri-list")) return null;
    // `clipboard.readBuffer` doesn't reliably hand back a real Node `Buffer` of *this* realm
    // (observed: its own `.toString("utf-8")` silently ignored the encoding and fell through to
    // plain `Array.prototype.toString` — a comma-joined list of byte values). `TextDecoder` is a
    // Web API that decodes any Uint8Array-like input correctly regardless of which realm/Buffer
    // subclass constructed it.
    const text = new TextDecoder("utf-8").decode(clipboard.readBuffer("text/uri-list"));
    return text || null;
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("mdnote:pickFolder"),
  pickMdnoteFile: (): Promise<string | null> => ipcRenderer.invoke("mdnote:pickMdnoteFile"),
  listNotesInFolder: (folderPath: string): Promise<NoteFileSummary[]> =>
    ipcRenderer.invoke("mdnote:listNotesInFolder", folderPath),
  readNote: (filePath: string): Promise<Note> => ipcRenderer.invoke("mdnote:readNote", filePath),
  writeNote: (filePath: string, note: Note): Promise<void> => ipcRenderer.invoke("mdnote:writeNote", filePath, note),
  createNote: (folderPath: string, title: string): Promise<{ filePath: string; note: Note }> =>
    ipcRenderer.invoke("mdnote:createNote", folderPath, title),
  deleteNote: (filePath: string): Promise<void> => ipcRenderer.invoke("mdnote:deleteNote", filePath),
  renameNoteFile: (filePath: string, title: string): Promise<string> =>
    ipcRenderer.invoke("mdnote:renameNoteFile", filePath, title),
  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke("mdnote:getRecentFiles"),
  addRecentFile: (filePath: string): Promise<void> => ipcRenderer.invoke("mdnote:addRecentFile", filePath),
  getPinnedFiles: (): Promise<string[]> => ipcRenderer.invoke("mdnote:getPinnedFiles"),
  togglePinnedFile: (filePath: string): Promise<string[]> => ipcRenderer.invoke("mdnote:togglePinnedFile", filePath),
  getLastFolder: (): Promise<string | null> => ipcRenderer.invoke("mdnote:getLastFolder"),
  getHasSeenWelcome: (): Promise<boolean> => ipcRenderer.invoke("mdnote:getHasSeenWelcome"),
  markWelcomeSeen: (): Promise<void> => ipcRenderer.invoke("mdnote:markWelcomeSeen"),
  ensureWelcomeNoteFile: (): Promise<string> => ipcRenderer.invoke("mdnote:ensureWelcomeNoteFile"),
  openNoteInNewWindow: (filePath: string): Promise<void> => ipcRenderer.invoke("mdnote:openNoteInNewWindow", filePath),
  exportNotePdf: (folderPath: string, filePath: string, title: string): Promise<string | null> =>
    ipcRenderer.invoke("mdnote:exportNotePdf", folderPath, filePath, title),
  notifyPrintReady: (contentHeight: number): void => ipcRenderer.send("mdnote:print-ready", contentHeight),
  onMenuOpenFolder: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-open-folder", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-open-folder", listener);
  },
  onMenuNewNote: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-new-note", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-new-note", listener);
  },
  onMenuShowGuideline: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-show-guideline", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-show-guideline", listener);
  },
};

export type MdnoteApi = typeof mdnoteApi;

contextBridge.exposeInMainWorld("mdnote", mdnoteApi);
