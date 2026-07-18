import { createBlankNote, deserializeMdNote, serializeMdNote, type Note } from "@notegpt/core";
import { dialog, ipcMain, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import { extname, join } from "node:path";
import { addRecentFile, getRecentFiles } from "./recentFiles.js";
import { getLastFolder, setLastFolder } from "./settings.js";

const MDNOTE_EXT = ".mdnote";

export interface NoteFileSummary {
  filePath: string;
  title: string;
  updatedAt: string;
}

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "untitled";
}

async function uniqueFilePath(folderPath: string, title: string): Promise<string> {
  const base = slugify(title);
  let candidate = join(folderPath, `${base}${MDNOTE_EXT}`);
  let suffix = 1;
  while (
    await fs
      .access(candidate)
      .then(() => true)
      .catch(() => false)
  ) {
    candidate = join(folderPath, `${base}-${suffix}${MDNOTE_EXT}`);
    suffix += 1;
  }
  return candidate;
}

export function registerFileHandlers(getWindow: () => BrowserWindow | null): void {
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
      filters: [{ name: "Markdown Note", extensions: ["mdnote"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("mdnote:listNotesInFolder", async (_event, folderPath: string): Promise<NoteFileSummary[]> => {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const mdnoteFiles = entries.filter((entry) => entry.isFile() && extname(entry.name) === MDNOTE_EXT);

    const summaries: NoteFileSummary[] = [];
    for (const entry of mdnoteFiles) {
      const filePath = join(folderPath, entry.name);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const note = deserializeMdNote(raw);
        summaries.push({ filePath, title: note.title, updatedAt: note.updatedAt });
      } catch {
        // skip files that aren't valid .mdnote documents
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  ipcMain.handle("mdnote:readNote", async (_event, filePath: string): Promise<Note> => {
    const raw = await fs.readFile(filePath, "utf-8");
    const note = deserializeMdNote(raw);
    await addRecentFile(filePath);
    return note;
  });

  ipcMain.handle("mdnote:writeNote", async (_event, filePath: string, note: Note): Promise<void> => {
    const raw = serializeMdNote(note);
    await fs.writeFile(filePath, raw, "utf-8");
  });

  ipcMain.handle(
    "mdnote:createNote",
    async (_event, folderPath: string, title: string): Promise<{ filePath: string; note: Note }> => {
      const note = createBlankNote(title);
      const filePath = await uniqueFilePath(folderPath, title);
      await fs.writeFile(filePath, serializeMdNote(note), "utf-8");
      await addRecentFile(filePath);
      return { filePath, note };
    }
  );

  ipcMain.handle("mdnote:deleteNote", async (_event, filePath: string): Promise<void> => {
    await fs.unlink(filePath);
  });

  ipcMain.handle("mdnote:getRecentFiles", async (): Promise<string[]> => getRecentFiles());
  ipcMain.handle("mdnote:addRecentFile", async (_event, filePath: string): Promise<void> => addRecentFile(filePath));

  ipcMain.handle("mdnote:getLastFolder", async (): Promise<string | null> => getLastFolder());
}
