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
