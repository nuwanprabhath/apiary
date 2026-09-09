#!/bin/bash
#
# Custom deb postinst script, replacing electron-builder's stock
# after-install.tpl (node_modules/app-builder-lib/templates/linux/after-install.tpl).
#
# WHY THIS EXISTS — DO NOT "SIMPLIFY" THIS BACK TO THE STOCK TEMPLATE:
#
# The stock template decides whether chrome-sandbox needs the SUID bit by
# probing user namespace support *at install time*, while running as root:
#
#   if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
#       chmod 4755 chrome-sandbox   # no userns -> needs SUID helper
#   else
#       chmod 0755 chrome-sandbox   # userns works -> SUID helper not needed
#   fi
#
# That probe is misleading on Ubuntu 24.04 (and other distros with
# unprivileged-userns-restrictions / AppArmor's
# kernel.apparmor_restrict_unprivileged_userns=1): root is exempt from that
# restriction, so the probe succeeds and the postinst takes the 0755 branch.
# But the app actually runs at *runtime* as an unprivileged user, where the
# restriction DOES apply. Chromium's namespace sandbox then fails to
# initialize, Electron falls back to the SUID sandbox helper, finds it isn't
# SUID (because postinst chose 0755), and aborts with:
#
#   [FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:...] The SUID
#   sandbox helper binary was found, but is not configured correctly.
#
# Fix: always set 4755 on chrome-sandbox, unconditionally, regardless of
# what install-time root can or cannot do. This is safe and is what most
# Electron apps ship: Chromium prefers the (faster, more isolated) namespace
# sandbox whenever the kernel actually allows it for the unprivileged runtime
# user, and only falls back to the SUID helper when it doesn't — so having
# the SUID bit set does not disable or weaken the namespace sandbox, it's
# purely a safety net for exactly this situation.
#
# Everything else below is unchanged from electron-builder's stock template
# (the update-alternatives/symlink block, mime/desktop database updates).

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Always set the SUID bit on chrome-sandbox — see comment block above.
chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
