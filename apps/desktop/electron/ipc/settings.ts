import { app } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";

interface Settings {
  lastFolder?: string;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Settings) : {};
  } catch {
    return {};
  }
}

export async function getLastFolder(): Promise<string | null> {
  const settings = await readSettings();
  return typeof settings.lastFolder === "string" ? settings.lastFolder : null;
}

export async function setLastFolder(folderPath: string): Promise<void> {
  const settings = await readSettings();
  settings.lastFolder = folderPath;
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}
