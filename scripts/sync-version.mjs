// Root package.json's "version" is the one place to bump. packages/core and
// packages/editor-ui dropped their own "version" field entirely (private, workspace-only,
// nothing ever read it). apps/desktop still needs a real one — electron-builder stamps
// built artifacts with it, and Electron's own app.getVersion() reads it at runtime — so
// that's the only file this actually has to write.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGE_PATHS = ["apps/desktop/package.json"];

const { version } = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));

for (const relativePath of PACKAGE_PATHS) {
  const path = join(rootDir, relativePath);
  const raw = readFileSync(path, "utf-8");
  const pkg = JSON.parse(raw);
  if (pkg.version === version) continue;

  pkg.version = version;
  const trailingNewline = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(path, JSON.stringify(pkg, null, 2) + trailingNewline);
  console.log(`synced ${relativePath} -> ${version}`);
}
