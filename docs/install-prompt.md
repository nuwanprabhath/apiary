Install or update the "Apiary" desktop app from
https://github.com/nuwanprabhath/apiary for me. Follow these steps in
order, and stop to tell me if any step fails:

1. Detect this machine's OS and CPU architecture. Releases are published for
   macOS on Apple silicon (arm64) and Linux x64; an Intel Mac (x64) builds
   from source (step 6). Anything else is not supported yet: tell me and stop.
2. Find the installed version, if any, without starting the app (Apiary has
   no `--version` flag; running it opens its window):
   - macOS: if `/Applications/Apiary.app` exists,
     `/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" /Applications/Apiary.app/Contents/Info.plist`.
   - Linux `.deb`: `dpkg-query -W -f='${Version}' apiary 2>/dev/null`.
   - Linux AppImage: if `~/Applications/Apiary.AppImage` exists, its version
     cannot be read without running it. It updates itself, so tell me it is
     installed and stop, unless I asked for a reinstall.
   - Nothing found: the installed version is "none".
3. Fetch `https://api.github.com/repos/nuwanprabhath/apiary/releases/latest`
   and take its tag without the leading `v`. If that fails or finds no
   release, go to the build-from-source path in step 6.
4. If the installed version equals the latest, tell me Apiary is already up to
   date and stop. Apiary also updates itself once installed (it offers new
   releases in the app), so this prompt is mostly for the first install.
5. Before replacing an installed copy, make sure Apiary is not running:
   on macOS `osascript -e 'quit app "Apiary"'`; on Linux ask me to quit it
   (do not kill processes by name).
6. Install the latest version:
   - **Prebuilt release** (the release has an asset for this machine):
     - macOS arm64: download `Apiary-<version>-arm64.dmg`, mount it
       (`hdiutil attach`), copy `Apiary.app` into `/Applications` (replacing
       any existing copy), unmount it, then run
       `xattr -cr /Applications/Apiary.app`. The app is not code-signed or
       notarized yet, so without this macOS refuses to open it.
     - Linux, Debian or Ubuntu: download `apiary_<version>_amd64.deb` and run
       `sudo apt install ./apiary_<version>_amd64.deb` (it pulls in what it
       needs). Prefer the `.deb` here: the AppImage needs `libfuse2`, which
       Ubuntu 22.04 and later do not install by default.
     - Linux, other distributions: download `Apiary-<version>.AppImage`,
       `chmod +x` it and move it to `~/Applications/Apiary.AppImage`
       (creating the folder if needed), replacing any existing copy.
   - **Build from source** (an Intel Mac, or no release found): needs Node.js
     22.22.1 or newer, and Xcode Command Line Tools on macOS or
     `build-essential` and Python 3 on Linux. Clone
     `https://github.com/nuwanprabhath/apiary` into `~/src/apiary` (or
     `git -C ~/src/apiary pull` if it is already there), run `npm ci`, then
     `npm run dist:mac:arm64`, `npm run dist:mac:x64` or `npm run dist:linux`
     to match this machine, and install what it writes under `release/` the
     same way as the prebuilt path.
7. Re-check the installed version as in step 2 and tell me what is installed
   now.

Apiary needs `claude` (Claude Code) on `PATH` to open and resume sessions, but
not to install. The prebuilt release needs no Node.js.
