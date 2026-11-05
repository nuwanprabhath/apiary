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

## The command-line update (`apiary --update`)

For a terminal, an SSH shell with nobody at the desktop say: `cliUpdate.ts` checks the same feed,
downloads and verifies the same `.deb`, and runs `sudo apt-get install` attached to the terminal
(`exec/runInTerminal.ts`), so sudo asks for the password there and Apiary never sees it. Then it
starts the running Apiary again as it was started: `runningApiary.ts` reads its pid from the
profile's `SingletonLock` link and its arguments, environment and cgroup from `/proc`, and the
relaunch is `relaunchCommand`, Install and restart's own, started before the old one is stopped
(SIGTERM, SIGKILL after 30 s). With `--background`, an Apiary that was not running is started in
the background (`startCommand`). Linux `.deb` only: an AppImage and a Mac update from the banner.

- **It is not Apiary.** `--update` holds no single-instance lock and starts no services, so it
  runs beside the Apiary it updates; `index.ts` runs it before `start()` and exits.
- **Chromium rewrites its main process's title**, so `/proc/<pid>/cmdline` is one string joined by
  spaces, not NUL-separated words (`commandLineWords`). Read as one word, the restart ran with no
  arguments and, in the Docker bed, failed Chromium's sandbox with no `--no-sandbox`.
- `tests/unit/cliUpdate.test.ts` drives every branch; `tests/update/updateDeb.test.ts` runs it for
  real: a background Apiary with no display, then `apiary --update` from a shell with none.

## The background service (`apiary --install-service`)

`backgroundService.ts` writes the user unit apiary.service under ~/.config/systemd/user (`ExecStart=… --background`,
`Restart=on-failure`, `WantedBy=default.target`), enables and starts it, and runs `loginctl
enable-linger` so it outlives a logout and starts at boot; polkit may refuse linger over SSH, and
then it says to run it with sudo. With remote access off it refuses: a background Apiary would quit.

- **Chromium moves its main process into a scope of its own** (`app-apiary-<pid>.scope`), so the
  service is found on the parent: the process that ran Apiary again with no display stays in
  `apiary.service` (`RunningApiary.parentCgroup`, and `process.ppid` in `platformInstaller.ts`).
  An update of a service-run Apiary is then `systemctl --user restart apiary.service`
  (`relaunchCommand`), so systemd keeps managing the new version. Seen under real systemd in Docker:
  read from the process's own cgroup, the update started the new version in a unit of its own and
  the service went inactive.
- The Docker beds have no systemd; the install, and the update restarting the service, were run by
  hand in a privileged systemd container. `tests/unit/backgroundService.test.ts` pins the steps.
