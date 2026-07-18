import type { Note } from "@notegpt/core";
import { contextBridge, ipcRenderer } from "electron";
import type { NoteFileSummary } from "./ipc/fileHandlers.js";

export const mdnoteApi = {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("mdnote:pickFolder"),
  pickMdnoteFile: (): Promise<string | null> => ipcRenderer.invoke("mdnote:pickMdnoteFile"),
  listNotesInFolder: (folderPath: string): Promise<NoteFileSummary[]> =>
    ipcRenderer.invoke("mdnote:listNotesInFolder", folderPath),
  readNote: (filePath: string): Promise<Note> => ipcRenderer.invoke("mdnote:readNote", filePath),
  writeNote: (filePath: string, note: Note): Promise<void> => ipcRenderer.invoke("mdnote:writeNote", filePath, note),
  createNote: (folderPath: string, title: string): Promise<{ filePath: string; note: Note }> =>
    ipcRenderer.invoke("mdnote:createNote", folderPath, title),
  deleteNote: (filePath: string): Promise<void> => ipcRenderer.invoke("mdnote:deleteNote", filePath),
  getRecentFiles: (): Promise<string[]> => ipcRenderer.invoke("mdnote:getRecentFiles"),
  addRecentFile: (filePath: string): Promise<void> => ipcRenderer.invoke("mdnote:addRecentFile", filePath),
  getLastFolder: (): Promise<string | null> => ipcRenderer.invoke("mdnote:getLastFolder"),
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
};

export type MdnoteApi = typeof mdnoteApi;

contextBridge.exposeInMainWorld("mdnote", mdnoteApi);
