import { contextBridge, ipcRenderer } from "electron";
const mdnoteApi = {
  pickFolder: () => ipcRenderer.invoke("mdnote:pickFolder"),
  pickMdnoteFile: () => ipcRenderer.invoke("mdnote:pickMdnoteFile"),
  listNotesInFolder: (folderPath) => ipcRenderer.invoke("mdnote:listNotesInFolder", folderPath),
  readNote: (filePath) => ipcRenderer.invoke("mdnote:readNote", filePath),
  writeNote: (filePath, note) => ipcRenderer.invoke("mdnote:writeNote", filePath, note),
  createNote: (folderPath, title) => ipcRenderer.invoke("mdnote:createNote", folderPath, title),
  deleteNote: (filePath) => ipcRenderer.invoke("mdnote:deleteNote", filePath),
  renameNoteFile: (filePath, title) => ipcRenderer.invoke("mdnote:renameNoteFile", filePath, title),
  getRecentFiles: () => ipcRenderer.invoke("mdnote:getRecentFiles"),
  addRecentFile: (filePath) => ipcRenderer.invoke("mdnote:addRecentFile", filePath),
  getPinnedFiles: () => ipcRenderer.invoke("mdnote:getPinnedFiles"),
  togglePinnedFile: (filePath) => ipcRenderer.invoke("mdnote:togglePinnedFile", filePath),
  getLastFolder: () => ipcRenderer.invoke("mdnote:getLastFolder"),
  getHasSeenWelcome: () => ipcRenderer.invoke("mdnote:getHasSeenWelcome"),
  markWelcomeSeen: () => ipcRenderer.invoke("mdnote:markWelcomeSeen"),
  ensureWelcomeNoteFile: () => ipcRenderer.invoke("mdnote:ensureWelcomeNoteFile"),
  openNoteInNewWindow: (filePath) => ipcRenderer.invoke("mdnote:openNoteInNewWindow", filePath),
  exportNotePdf: (folderPath, filePath, title) => ipcRenderer.invoke("mdnote:exportNotePdf", folderPath, filePath, title),
  notifyPrintReady: (contentHeight) => ipcRenderer.send("mdnote:print-ready", contentHeight),
  onMenuOpenFolder: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-open-folder", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-open-folder", listener);
  },
  onMenuNewNote: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-new-note", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-new-note", listener);
  },
  onMenuShowGuideline: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-show-guideline", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-show-guideline", listener);
  }
};
contextBridge.exposeInMainWorld("mdnote", mdnoteApi);
export {
  mdnoteApi
};
