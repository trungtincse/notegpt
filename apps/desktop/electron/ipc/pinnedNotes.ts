import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";

function pinnedNotesPath(): string {
  return join(app.getPath("userData"), "pinned-notes.json");
}

export async function getPinnedFiles(): Promise<string[]> {
  try {
    const raw = await fs.readFile(pinnedNotesPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export async function togglePinnedFile(filePath: string): Promise<string[]> {
  const existing = await getPinnedFiles();
  const next = existing.includes(filePath) ? existing.filter((entry) => entry !== filePath) : [filePath, ...existing];
  await fs.writeFile(pinnedNotesPath(), JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export async function removePinnedFile(filePath: string): Promise<void> {
  const existing = await getPinnedFiles();
  if (!existing.includes(filePath)) return;
  await fs.writeFile(
    pinnedNotesPath(),
    JSON.stringify(
      existing.filter((entry) => entry !== filePath),
      null,
      2
    ),
    "utf-8"
  );
}
