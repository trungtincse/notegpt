// Root package.json's "version" is the one place to bump — this copies it into every other
// workspace package.json (all private, workspace-internal packages; none of them are
// published separately, so there's no reason their version fields should ever be edited by
// hand instead of just kept in sync with the root).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGE_PATHS = ["package.json", "packages/core/package.json", "packages/editor-ui/package.json", "apps/desktop/package.json"];

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
