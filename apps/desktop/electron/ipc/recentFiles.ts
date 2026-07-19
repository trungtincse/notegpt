import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const MAX_RECENT = 3;

function recentFilesPath(): string {
  return join(app.getPath("userData"), "recent-files.json");
}

export async function getRecentFiles(): Promise<string[]> {
  try {
    const raw = await fs.readFile(recentFilesPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export async function addRecentFile(filePath: string): Promise<void> {
  const existing = await getRecentFiles();
  const next = [filePath, ...existing.filter((entry) => entry !== filePath)].slice(0, MAX_RECENT);
  await fs.writeFile(recentFilesPath(), JSON.stringify(next, null, 2), "utf-8");
}

export async function removeRecentFile(filePath: string): Promise<void> {
  const existing = await getRecentFiles();
  if (!existing.includes(filePath)) return;
  await fs.writeFile(
    recentFilesPath(),
    JSON.stringify(
      existing.filter((entry) => entry !== filePath),
      null,
      2
    ),
    "utf-8"
  );
}
