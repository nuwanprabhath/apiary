# Environment variables and on-disk state

All `APIARY_*` test/launch hooks are parsed once, in `src/main/app/env.ts`'s `parseRuntimeEnv`, and
read through `readTestEnv`, which returns `undefined` for every one of them in a packaged build
(`app.isPackaged`) — they exist so the E2E suite can point the app at fixture data, a fake updater,
or a stand-in binary, and none of them must be usable to redirect a real install.

| Variable | Set by | Effect |
| --- | --- | --- |
| `APIARY_CONFIG_ROOT` | test harness | overrides the Claude config root (`resolveConfigRoot()`) |
| `APIARY_DB_PATH` | test harness | overrides `userData/apiary.db` |
| `APIARY_FAKE_LIVE` | test harness | reports a session id as "live" with no real Claude process |
| `APIARY_CODE_PATH` | test harness | substitutes a fake `code` binary (empty = "not found") |
| `APIARY_GLAB_PATH` | test harness | points the GitLab plugin's `glab` calls at a stand-in binary |
| `APIARY_PICK_FOLDER` | test harness | answers the native folder picker (a group's "+") with this path instead of opening the dialog |
| `APIARY_PET_EXPORT_PATH` | test harness | answers the pet export save dialog with this path |
| `APIARY_PET_IMPORT_PATH` | test harness | answers the pet import open dialog with this path |
| `APIARY_WINDOW_CHROME` | test harness | forces a window's title bar: `custom` (Windows/Linux themed bar and menus), `mac` or `system` |
| `APIARY_DEFAULT_THEME=original` | test harness | starts a fresh profile on the pre-Liquid-Glass theme |
| `APIARY_FAKE_UPDATE`, `APIARY_FAKE_UPDATE_MODE` | test harness | drives the update banner with no network |
| `APIARY_HEADLESS` | test harness | keeps every window off-screen |
| `ELECTRON_RENDERER_URL` | dev / test harness | points at the Vite dev server instead of `out/` |
| `APIARY_SAFE_THEME` / `--safe-theme` | user | resets to the built-in theme; **always honoured**, not gated by `isPackaged` — a recovery path, not a test hook |
| `CLAUDE_CONFIG_DIR` | user / Claude Code | overrides `~/.claude` (`resolveConfigRoot()`) |
| `CLAUDE_CODE_CHILD_SESSION` and friends | inherited from a parent Claude Code shell | stripped from spawned shells (`pty/childEnv.ts`) so a nested `claude` still writes its own JSONL |
| `APIARY_USER_ZDOTDIR` | set *by* Apiary, for the zsh minimal-prompt shim | not a user-facing var — see [`src/main/pty/CLAUDE.md`](../src/main/pty/CLAUDE.md) |
| `APPIMAGE` | the AppImage runtime | path of the running image, read by the updater to reinstall itself |
| `APIARY_HEADED` | test harness (not the app) | runs e2e with visible windows |
| `APIARY_LIVE_CLAUDE` | test harness (not the app) | opts into `tests/e2e/live/` (spends tokens) |
| `APIARY_BENCH`, `APIARY_BENCH_GPU`, `APIARY_BENCH_OUT`, `APIARY_BENCH_RUNS`, `APIARY_BENCH_THEMES` | test harness (not the app) | theme performance bench options |
| `VERBOSE` | dev tooling | echoes pty output while recording activity fixtures |

**On-disk state**, all under Electron's `userData` directory unless overridden above:

| File | Owner |
| --- | --- |
| `apiary.db` (+ `-wal`/`-shm`) | `main/store/` — the session store |
| `search.db` (+ `-wal`/`-shm`) | `main/search/` — the FTS5 index (derived, rebuildable) |
| `settings.json` | `main/settings.ts` |
| `session-layout.json` | `main/windows/sessionLayoutStore.ts` |
| `themes.json` | `main/theme/` (`ThemeStore`) |
| `pets.json` | `main/pets/` (`PetStore`) — whether pets are on, every installed pet and where it stands |
| `prompt-shim/zsh` | `main/pty/promptPath.ts` (written at startup) |
| `pasted-images/` | `main/` `ImageStore` (chat image attachments) |
| `logs/` | `main/log/` — only exists once Diagnostics is switched on |

This is the method behind ["Measure before fixing"](debugging.md): read the actual state
(`apiary.db`, `search.db`) rather than guessing from the code.
