const { existsSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");

// Chromium's zygote host fatals at launch if `chrome-sandbox` is present next to the
// executable but isn't a correctly-configured setuid-root (4755) binary — this is a hard
// abort ("found, but is not configured correctly"), not something `--no-sandbox` (already
// passed in electron/main.ts) suppresses. Observed specifically on a real Ubuntu 24.04
// desktop (AppArmor restricts unprivileged user namespaces there by default, which is what
// pushes the zygote down this code path at all). Since this app deliberately never uses
// Chromium's real sandbox, the file being present at all only creates a way to crash, never
// a benefit — deleting it here (once, right after electron-builder unpacks each target)
// means that check finds nothing and `--no-sandbox` governs cleanly.
exports.default = async function afterPack(context) {
  const sandboxPath = join(context.appOutDir, "chrome-sandbox");
  if (existsSync(sandboxPath)) unlinkSync(sandboxPath);
};
