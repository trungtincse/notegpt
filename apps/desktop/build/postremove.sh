#!/bin/bash
set -e

# Same situation as postinstall.sh: a custom `deb.afterRemove` replaces electron-builder's
# own default after-remove template rather than extending it, so its one piece of essential
# housekeeping (undoing update-alternatives' /usr/bin symlink) is reproduced here by hand.
if type update-alternatives >/dev/null 2>&1; then
  update-alternatives --remove 'NoteGPT' '/usr/bin/NoteGPT' || true
else
  rm -f '/usr/bin/NoteGPT'
fi

# Unloads and removes the AppArmor profile installed by postinstall.sh, so an uninstall
# doesn't leave a stale profile referencing a binary that's no longer there.
APPARMOR_PROFILE_PATH="/etc/apparmor.d/notegpt"

if [ -f "$APPARMOR_PROFILE_PATH" ]; then
  if command -v apparmor_parser >/dev/null 2>&1; then
    apparmor_parser -R "$APPARMOR_PROFILE_PATH" || true
  fi
  rm -f "$APPARMOR_PROFILE_PATH"
fi
