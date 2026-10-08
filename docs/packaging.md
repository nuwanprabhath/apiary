# Packaging

Maintainer-facing build and packaging internals, moved out of the user-facing README. See root
[`CLAUDE.md`](../CLAUDE.md)'s "Versioning, changelog, commits" for the release process this feeds
into, and [`src/main/update/CLAUDE.md`](../src/main/update/CLAUDE.md) for why the artifacts listed
here (`latest-*.yml`, the macOS `zip` target) matter to the in-app updater.

Prebuilt artifacts for macOS (arm64) and Linux (x64) are attached to each
[GitHub release](https://github.com/nuwanprabhath/apiary/releases), built by
`.github/workflows/release.yml` on a `v*` tag push — see that file's own
comments for why it builds each OS/arch natively on its own runner rather
than cross-compiling, and why there's no automated x64 macOS build (GitHub's
Intel Mac runner capacity has become unreliable enough that it isn't worth
carrying). To build locally instead:

    npm run dist

On macOS this produces a `.dmg` for **your machine's own architecture only**
(arm64 on Apple Silicon, x64 on Intel), under `release/`. On Linux it
produces an `.AppImage` plus `.deb` (x64). `npm run dist` runs `npm run build`
(`electron-vite build`) and then `scripts/dist.mjs`, which invokes `electron-builder`. Neither script
rebuilds the native modules: `better-sqlite3` and `node-pty` ship N-API prebuilds that load under
Electron as they are ([testing.md](testing.md)). The only rebuild step is `electron-builder`'s own
`npmRebuild`, which is what the cross-arch notes below are about.

`electron-builder.yml` itself declares both `arm64` and `x64` as mac dmg
targets, but `npm run dist` deliberately scopes the actual build to the host
arch (via `scripts/dist.mjs`) rather than building both by default. Building
the *other* mac arch means `@electron/rebuild`/`electron-builder` cross-compile
`better-sqlite3`'s native binding for that arch, which goes through
node-gyp's Python toolchain — and on a modern Python (3.12+, which removed
`distutils`) without `setuptools` installed, that cross-arch compile fails
with `ModuleNotFoundError: No module named 'distutils'`. Rather than have
`npm run dist` fail on a fresh machine for an arch nobody asked for, the
default is host-arch-only, which works with no extra setup. `dist:mac:arm64`
and `dist:mac:x64` go through the same `scripts/dist.mjs` dispatcher as
`dist` (passing the requested arch as an argument), so they get the same
single-arch `--config` narrowing rather than relying on electron-builder's
own `--arm64`/`--x64` flags, which do **not** scope the build on their own —
see the implementation note in `scripts/dist.mjs` for why. `dist:mac:all`
and `dist:linux` invoke `electron-builder` directly against
`electron-builder.yml`, since neither passes an arch flag that needs
narrowing (`--arm64 --x64` matches the file's own `arch: [arm64, x64]`
already; `--linux` doesn't touch `mac` at all).

    npm run dist:mac:arm64   # arm64 only — verified, both locally and via CI, see below
    npm run dist:mac:x64     # x64 only — requires setuptools/distutils on an arm64 host, see below
    npm run dist:mac:all     # both, in one electron-builder invocation — not run on this machine (would hit the same x64 gap)
    npm run dist:linux       # AppImage + deb (must run on Linux) — verified via CI, see below

**`dist:mac:arm64` — verified.** Produces `release/Apiary-<version>-arm64.dmg` and
`release/mac-arm64/Apiary.app`, with `release/builder-debug.yml` showing only
an `arm64:` key (no `x64:`) — confirming the arch narrowing works the same
way `dist` itself does. Also the artifact the release workflow's macOS leg
produces and attaches to each GitHub release.

**`dist:mac:x64` — fails on an arm64 dev machine**, for the same `distutils`
reason as plain `dist`'s x64 leg (see above): `@electron/rebuild`
cross-compiling `better-sqlite3` for x64 hits `node-gyp failed to rebuild ...
ModuleNotFoundError: No module named 'distutils'` before electron-builder
ever reaches the packaging step, and no x64 artifact is produced. This is a
cross-compile toolchain gap, not a scripting bug — running this same script
natively on an actual x64 Mac never hits it at all (nothing to cross-compile
for), which is exactly why the release workflow originally built this leg on
a native x64 GitHub runner rather than cross-compiling from the arm64 one —
see that workflow's comments for why it's no longer in CI. Not fixed here:
this typically needs Homebrew-managed Python's PEP 668 guard overridden (or a
`setuptools` install) to install cross-compile tooling, which is a
machine-level choice left to whoever runs this, not something to do silently
as part of a build.

Packaging has the same `spawn-helper` executable-bit problem as install does,
but `postinstall` doesn't run during packaging and electron-builder's
`asarUnpack` copy step (native modules can't load from inside an asar, so
`better-sqlite3` and `node-pty` are unpacked) is itself a known way to drop
the bit. `electron-builder.yml` wires an `afterPack` hook
(`build/afterPack.cjs`) that reuses the same fix, applied to node-pty as it
sits inside the packaged app's `app.asar.unpacked` directory, so packaged
installs don't regress a bug already fixed for local installs.

**Linux artifacts are verified.** `dist:linux` runs successfully on the
release workflow's `ubuntu-24.04` runner and produces both a real
`.AppImage` and `.deb`, attached to each GitHub release — the `linux:`
section of `electron-builder.yml` has actually been exercised on Linux, not
just configured. Installing and launching the result on a real Linux
desktop (as opposed to just the CI runner successfully packaging it) has
not been separately confirmed.

**AppImage sandboxing on Ubuntu 24.04+.** The `.deb` ships a custom
`afterInstall` script (`build/linux-after-install.sh`) that always sets the
SUID bit on `chrome-sandbox`, so it works out of the box even where
unprivileged user namespaces are restricted (Ubuntu 24.04's
`kernel.apparmor_restrict_unprivileged_userns=1`). The AppImage can't use
that fix — AppImages are mounted `nosuid`, so a SUID sandbox helper never
works there regardless of permissions. On an affected system the AppImage
will abort on launch with a `SUID sandbox helper binary ... not configured
correctly` error; run it with `--no-sandbox`, or install the `.deb` instead.

**Codesigning check before ever launching a packaged build**: run
`codesign --verify --deep --strict release/mac-arm64/Apiary.app` first. An
invalid signature makes macOS kill the app at launch with an "Apiary quit
unexpectedly" dialog rather than a useful error.
