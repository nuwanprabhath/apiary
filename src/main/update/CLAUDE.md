# Updating

Read with root CLAUDE.md; this covers the update checker, capability detection and the release
metadata it depends on. See also root CLAUDE.md's "Versioning, changelog, commits" for the release
process that produces the artifacts this code consumes.

`src/main/update/` checks GitHub Releases and offers what it finds. The shape of it is decided by
one fact, in `capability.ts`: **Squirrel.Mac will only replace a bundle whose signature satisfies
the running app's designated requirement, and Apiary is unsigned.** So an unsigned macOS build can
never install an update in place — it downloads the .dmg, verifies it, and opens it for the user.
Linux AppImage can install itself; a .deb cannot (it needs root). The capability is decided up
front rather than discovered at install time, because the alternative is failing *after* a
download.

The day a Developer ID certificate exists, `hasDeveloperIdSignature()` returns true, macOS becomes
`auto`, and nothing else has to change.

**On Linux the assisted download is the `.deb`, never the AppImage** (`pickInstaller`). Only a
.deb installation takes the assisted path — an AppImage run updates itself — and for a long time it
was handed the AppImage: a different packaging from the one it came from, which on Ubuntu 22.04+
does not even start without libfuse2. A release with no `.deb` is an error, not a fallback.

Two things are easy to break from outside the code:

- **The release must contain `latest-mac.yml` / `latest-linux.yml`.** They are what an installed
  app reads to discover a version; a release without them is invisible to every existing install.
  electron-builder generates them because `electron-builder.yml` declares a `publish` provider, and
  `.github/workflows/release.yml` uploads them alongside the installers.
- **The macOS `zip` target must stay.** `latest-mac.yml` names it, and Squirrel installs from it —
  a release with only a .dmg describes a file that is not there.

The service (`updateService.ts`) keeps every rule — when to check, what to offer, what a skip
means — behind an injected `UpdateBackend`, so `tests/unit/updateService.test.ts` can drive
the whole state machine with a stub and a fake clock. That matters more here than elsewhere: the
real path cannot be exercised without publishing a release, so whatever is not tested there is not
tested at all. `APIARY_FAKE_UPDATE` / `APIARY_FAKE_UPDATE_MODE` do the same job for the E2E suite.

## Install and restart (the assisted path can install)

On an `assisted` installation the banner's primary button is Install and restart:
`UpdateService.prepareInstall` downloads and verifies the installer (without opening it), asks the
backend whether sudo needs a password, and either installs at once or waits in `needs-password`
for `installAndRestart(password)`. Install is refused unless the status is in that downloaded-for-
install state and the file still hashes to the sha512 it was verified against (`stillVerified`). The
rules are in the service; the platform work is `platformInstaller.ts`, and every command and script
it runs is a pure function in `installCommands.ts`.

- **Ubuntu (.deb).** `sudo -n true` says whether a password is needed, which is also true while
  sudo's credentials are only cached. So with no password apt runs under `sudo -n` (`-k` would
  drop that cache and read an empty password); if sudo wants one after all (the cache expired), the
  outcome is `password-required` and the banner asks without saying anything was refused. With a
  password, `sudo -S -k -p '' apt-get install -y --allow-downgrades <deb>` runs while Apiary is
  still running; a refused password is
  told from an apt failure by sudo's exit and stderr (`isPasswordRefusal`), nothing more. On
  success the .deb is deleted, then the restart.
- **Restart survives systemd.** The maintainer starts Apiary with `systemd-run --user --collect`;
  stopping that unit kills its whole cgroup, so `app.relaunch()` would die with it. When
  the process's own cgroup file puts it under the user manager (`systemdUserUnit`), the new
  instance gets its own transient unit (`systemd-run --user --collect --setenv=…` for the display,
  bus and `APIARY_*` variables); otherwise a `setsid -f` helper. Either is a `sh -c` that waits for
  the old pid to exit (the single-instance lock), then `exec`s `process.execPath`, which apt
  replaced in place, with the original arguments (`--user-data-dir=` included; Chromium adds its
  internal switches only to child processes).
- **macOS (.dmg).** An app run from `/AppTranslocation/` (a quarantined copy macOS made read-only)
  is refused before any password is asked, with what to do instead. A running bundle must not be replaced, so `macInstallScript` writes a helper to a
  fresh 0700 temp dir and starts it detached (under `sudo -S` only when the bundle or its folder is
  not writable). After Apiary quits it mounts the .dmg, `ditto`s the new app beside the old, swaps
  them with a way back, runs `xattr -cr` on the installed bundle, deletes the .dmg only on success,
  writes a one-line result file under userData and relaunches as the logged-in user. The next start
  reads and deletes that file (`restorePreviousInstall`): a failure shows in the banner with the
  kept .dmg; a success says nothing. The downloaded .dmg still gets `setQuarantine`.
- **Where the password goes.** Only to sudo's stdin (`runWithInput`, `launchDetachedWithInput` in
  `main/exec`). Never into argv, a file, a log line or `UpdateStatusPayload`;
  `tests/unit/platformInstaller.test.ts` runs an install with a known password and checks the log
  and every status. The renderer clears it from React state as soon as it is sent.
- **A remote window** drives the work machine's updater (every `update*` channel is `remote`), so
  its password goes to the work machine's sudo over the paired connection.
- `APIARY_FAKE_UPDATE_FILE` makes the fake backend "download" a real installer, so the real install
  path can run in a test.
