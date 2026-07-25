import { concatMarkdownBlocks, createBlankNote, deserializeMdNote, serializeMdNote, type AnnotationScene, type Note } from "@notegpt/core";
import { app, dialog, ipcMain, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import { dirname, extname, join } from "node:path";
import { getPinnedFiles, removePinnedFile, renamePinnedFile, togglePinnedFile } from "./pinnedNotes.js";
import { addRecentFile, getRecentFiles, removeRecentFile, renameRecentFile } from "./recentFiles.js";
import { getHasSeenWelcome, getLastFolder, markWelcomeSeen, setLastFolder } from "./settings.js";

const MDNOTE_EXT = ".mdnote";

// electron-vite bundles the whole main process into a single out/main/main.js, so __dirname
// here is always "<app root>/out/main" in both dev and the packaged app.asar — no
// app.isPackaged branching needed to find the bundled resources/ folder next to it.
const BUNDLED_WELCOME_NOTE_PATH = join(__dirname, "../../resources/welcome.mdnote");

export interface NoteFileSummary {
  filePath: string;
  title: string;
  markdown: string;
  annotationText: string;
  updatedAt: string;
}

/** Pulls just the text out of an annotation scene's Excalidraw text elements, for search — not the whole scene, which can carry embedded images. */
function extractAnnotationText(scene: AnnotationScene): string {
  return scene.elements
    .filter((element): element is { type: string; text: string } => {
      if (typeof element !== "object" || element === null) return false;
      const candidate = element as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string";
    })
    .map((element) => element.text)
    .join(" ");
}

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    // "đ" doesn't decompose under NFD (it's its own Latin letter, not "d" + a combining
    // mark), so it needs an explicit swap before the NFD strip below handles the rest of
    // Vietnamese's diacritics (as well as other accented Latin scripts).
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "untitled";
}

/** `excludePath`, when given, is a path allowed to already exist without counting as a
 * collision — used when renaming a file to its own unchanged (or case-only-changed) slug. */
async function uniqueFilePath(folderPath: string, title: string, excludePath?: string): Promise<string> {
  const base = slugify(title);
  let candidate = join(folderPath, `${base}${MDNOTE_EXT}`);
  let suffix = 1;
  while (
    candidate !== excludePath &&
    (await fs
      .access(candidate)
      .then(() => true)
      .catch(() => false))
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
        summaries.push({
          filePath,
          title: note.title,
          markdown: concatMarkdownBlocks(note.markdownBlocks),
          annotationText: extractAnnotationText(note.annotation),
          updatedAt: note.updatedAt,
        });
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

  // Renames a note on disk to match its new title (not just the `title` field inside the file),
  // so the file the user sees in a normal file browser stays in sync with what's shown in-app.
  // Keeps whatever unique-suffix scheme createNote uses, and repoints pinned/recent entries so
  // renaming doesn't silently unpin or drop a note from Recents.
  ipcMain.handle("mdnote:renameNoteFile", async (_event, filePath: string, title: string): Promise<string> => {
    const raw = await fs.readFile(filePath, "utf-8");
    const note = deserializeMdNote(raw);
    const folderPath = dirname(filePath);
    const newFilePath = await uniqueFilePath(folderPath, title, filePath);
    const updated: Note = { ...note, title, updatedAt: new Date().toISOString() };
    await fs.writeFile(newFilePath, serializeMdNote(updated), "utf-8");
    if (newFilePath !== filePath) {
      await fs.unlink(filePath);
      await renamePinnedFile(filePath, newFilePath);
      await renameRecentFile(filePath, newFilePath);
    }
    return newFilePath;
  });

  ipcMain.handle("mdnote:deleteNote", async (_event, filePath: string): Promise<void> => {
    await fs.unlink(filePath);
    await removeRecentFile(filePath);
    await removePinnedFile(filePath);
  });

  ipcMain.handle("mdnote:getRecentFiles", async (): Promise<string[]> => getRecentFiles());
  ipcMain.handle("mdnote:addRecentFile", async (_event, filePath: string): Promise<void> => addRecentFile(filePath));

  ipcMain.handle("mdnote:getPinnedFiles", async (): Promise<string[]> => getPinnedFiles());
  ipcMain.handle("mdnote:togglePinnedFile", async (_event, filePath: string): Promise<string[]> => togglePinnedFile(filePath));

  ipcMain.handle("mdnote:getLastFolder", async (): Promise<string | null> => getLastFolder());

  ipcMain.handle("mdnote:getHasSeenWelcome", async (): Promise<boolean> => getHasSeenWelcome());
  ipcMain.handle("mdnote:markWelcomeSeen", async (): Promise<void> => markWelcomeSeen());

  // Copies the bundled first-launch note (a real, hand-editable .mdnote file authored in
  // apps/desktop/resources/) into userData the first time it's needed, so edits — including
  // annotations — persist like any other note instead of being silently discarded. Never
  // overwrites an existing file, so a user's edits to it survive across app updates that change
  // the bundled seed content.
  ipcMain.handle("mdnote:ensureWelcomeNoteFile", async (): Promise<string> => {
    const filePath = join(app.getPath("userData"), `welcome${MDNOTE_EXT}`);
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      const seedRaw = await fs.readFile(BUNDLED_WELCOME_NOTE_PATH, "utf-8");
      await fs.writeFile(filePath, seedRaw, "utf-8");
    }
    return filePath;
  });
}
