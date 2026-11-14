#!/bin/bash
# electron-builder template: ${...} placeholders are filled at package time. Removes only the CLI link
# this package owns, then the AppArmor profile, as electron-builder's default after-remove script does.

if [ "$(readlink /usr/bin/sfxchat)" = '/opt/${sanitizedProductName}/resources/agent/sfxchat' ]; then
    rm -f '/usr/bin/sfxchat'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
