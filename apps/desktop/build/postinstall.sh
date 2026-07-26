#!/bin/bash
set -e

# electron-builder normally generates this whole file itself, but supplying a custom
# `deb.afterInstall` (needed for the AppArmor step below) replaces its default template
# rather than extending it — confirmed by inspecting the packaged postinst with
# `dpkg-deb -e`. So the update-alternatives/desktop-database housekeeping electron-builder
# would otherwise have done is reproduced here by hand; skipped entirely is only its default
# chrome-sandbox chmod step, since afterPack.cjs deletes that binary from the package (see
# its own comment for why).

if type update-alternatives 2>/dev/null >&1; then
  # Remove previous link if it doesn't use update-alternatives
  if [ -L '/usr/bin/NoteGPT' -a -e '/usr/bin/NoteGPT' -a "$(readlink '/usr/bin/NoteGPT')" != '/etc/alternatives/NoteGPT' ]; then
    rm -f '/usr/bin/NoteGPT'
  fi
  update-alternatives --install '/usr/bin/NoteGPT' 'NoteGPT' '/opt/NoteGPT/NoteGPT' 100 || ln -sf '/opt/NoteGPT/NoteGPT' '/usr/bin/NoteGPT'
else
  ln -sf '/opt/NoteGPT/NoteGPT' '/usr/bin/NoteGPT'
fi

if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
  update-desktop-database /usr/share/applications || true
fi

# Ubuntu 23.10+/24.04's default AppArmor policy restricts unprivileged user namespace
# creation. Chromium's zygote still calls unshare(CLONE_NEWUSER) unconditionally as part of
# its own startup (independent of --no-sandbox — confirmed via `journalctl -k` showing
# "operation=userns_create ... transitioning profile" immediately followed by a DENIED
# capability inside the resulting restricted profile, then a hard crash), which without this
# profile can surface as anything from a silently-uncomposited embedded iframe to a hard
# "FATAL: No usable sandbox!" depending on how the process was launched (a plain terminal
# exec vs. GNOME Shell's systemd-scoped app activation behave differently here). This is the
# same fix Chrome/VS Code ship for their own .deb packages: a profile scoped to just this
# binary, `unconfined` otherwise (so it doesn't add any new restriction), that explicitly
# permits the one operation actually being requested. See:
# https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
APPARMOR_PROFILE_PATH="/etc/apparmor.d/notegpt"

if [ -d /etc/apparmor.d ]; then
  cat > "$APPARMOR_PROFILE_PATH" <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile notegpt /opt/NoteGPT/NoteGPT flags=(unconfined) {
  userns,

  include if exists <local/notegpt>
}
EOF

  if command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser -r "$APPARMOR_PROFILE_PATH" || true
  fi
fi
