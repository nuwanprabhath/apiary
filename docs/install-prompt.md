Install or update the "Apiary" desktop app from
https://github.com/nuwanprabhath/apiary for me. Follow these steps in
order, and stop to tell me if any step fails:

1. Detect this machine's OS and CPU architecture (macOS arm64, macOS x64,
   or Linux x64) — Apiary doesn't support anything else yet.
2. Find the currently installed version, if any:
   - macOS: if `/Applications/Apiary.app` exists, read
     `CFBundleShortVersionString` from its `Info.plist` (e.g.
     `/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString"
     /Applications/Apiary.app/Contents/Info.plist`).
   - Linux: run `apiary --version` if it's on `PATH`, or
     `dpkg -s apiary 2>/dev/null | grep Version` if it was installed via
     `.deb`.
   - If none of those find anything, treat the installed version as "none".
3. Fetch `https://api.github.com/repos/nuwanprabhath/apiary/releases/latest`.
   If that 404s (no release published yet), skip straight to the
   build-from-source path in step 5 — there's nothing to compare against or
   download.
4. If a release was found, compare its tag (strip a leading `v`) against
   the installed version from step 2. If they already match, tell me
   Apiary is already up to date and stop — don't reinstall or rebuild
   anything.
5. Otherwise, install the new version, either by downloading a release or
   by building from source:
   - **Prebuilt artifact** (when step 3 found a release with an asset for
     this OS/arch — a `.dmg` for macOS, `.deb` or `.AppImage` for Linux):
     download it, then:
     - macOS: mount it (`hdiutil attach the.dmg`), copy `Apiary.app` into
       `/Applications` (replacing any existing copy), unmount the image,
       then run `xattr -cr /Applications/Apiary.app` — the app isn't
       code-signed or notarized yet, so without this Gatekeeper refuses to
       open it at all.
     - Linux `.deb`: `sudo apt install ./<file>.deb` (pulls in any missing
       dependencies automatically).
     - Linux `.AppImage`: `chmod +x` it and move it to
       `~/Applications/Apiary.AppImage` (creating that folder if it
       doesn't exist yet), replacing any existing copy.
   - **Build from source** (used automatically when there's no release
     yet, or if no asset matches this OS/arch): clone
     `https://github.com/nuwanprabhath/apiary` into `~/src/apiary` (or, if
     that folder already exists, `git -C ~/src/apiary pull` instead of
     cloning again), run `npm install`, then run whichever packaging
     script matches this OS/arch — `npm run dist:mac:arm64`,
     `npm run dist:mac:x64`, or `npm run dist:linux` — and install the
     artifact it produces under `release/` the same way as the prebuilt
     path above.
6. Re-check the installed version and tell me what's installed now.

This needs Node.js 22+ on my machine either way, and — only for the
build-from-source path — Xcode Command Line Tools on macOS or
`build-essential`/Python 3 on Linux. Apiary itself needs `claude` on
`PATH` to actually resume sessions, but that isn't required just to
install the app.
