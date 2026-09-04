import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const MAX_RECENT = 5;

function recentFoldersPath(): string {
  return join(app.getPath("userData"), "recent-folders.json");
}

export async function getRecentFolders(): Promise<string[]> {
  try {
    const raw = await fs.readFile(recentFoldersPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export async function addRecentFolder(folderPath: string): Promise<void> {
  const existing = await getRecentFolders();
  const next = [folderPath, ...existing.filter((entry) => entry !== folderPath)].slice(0, MAX_RECENT);
  await fs.writeFile(recentFoldersPath(), JSON.stringify(next, null, 2), "utf-8");
}

export async function removeRecentFolder(folderPath: string): Promise<void> {
  const existing = await getRecentFolders();
  if (!existing.includes(folderPath)) return;
  await fs.writeFile(
    recentFoldersPath(),
    JSON.stringify(
      existing.filter((entry) => entry !== folderPath),
      null,
      2
    ),
    "utf-8"
  );
}

export async function clearRecentFolders(): Promise<void> {
  await fs.writeFile(recentFoldersPath(), JSON.stringify([], null, 2), "utf-8");
}
