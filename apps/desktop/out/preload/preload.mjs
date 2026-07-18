import { contextBridge, ipcRenderer } from "electron";
const mdnoteApi = {
  pickFolder: () => ipcRenderer.invoke("mdnote:pickFolder"),
  pickMdnoteFile: () => ipcRenderer.invoke("mdnote:pickMdnoteFile"),
  listNotesInFolder: (folderPath) => ipcRenderer.invoke("mdnote:listNotesInFolder", folderPath),
  readNote: (filePath) => ipcRenderer.invoke("mdnote:readNote", filePath),
  writeNote: (filePath, note) => ipcRenderer.invoke("mdnote:writeNote", filePath, note),
  createNote: (folderPath, title) => ipcRenderer.invoke("mdnote:createNote", folderPath, title),
  deleteNote: (filePath) => ipcRenderer.invoke("mdnote:deleteNote", filePath),
  getRecentFiles: () => ipcRenderer.invoke("mdnote:getRecentFiles"),
  addRecentFile: (filePath) => ipcRenderer.invoke("mdnote:addRecentFile", filePath),
  onMenuOpenFolder: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-open-folder", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-open-folder", listener);
  },
  onMenuNewNote: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("mdnote:menu-new-note", listener);
    return () => ipcRenderer.removeListener("mdnote:menu-new-note", listener);
  }
};
contextBridge.exposeInMainWorld("mdnote", mdnoteApi);
export {
  mdnoteApi
};
