# Working on Apiary

Apiary is an Electron 38 + React 19 + strict-TS desktop app for browsing, searching and resuming
Claude Code sessions across folders and git worktrees. This file is the map, the rules and the
commands. The "why" for any one subsystem lives next to its code — a nested `CLAUDE.md` in that
directory, or a `docs/architecture/*.md` for anything that spans main and renderer — and loads
automatically when you read a file there. See "Where the long-form lives" at the end of this file
for the full index. Nothing below is deleted history: it moved.

## Architecture map

- **`src/main/`** — the Electron main process. Owns the SQLite store, the PTYs, the filesystem
  watcher, git commands and the search index. Everything that touches the machine lives here.
- **`src/renderer/`** — React 19 UI. No Node access: it reaches the main process only through the
  typed bridge `window.apiary` (`ApiaryApi`), implemented by `src/preload/index.ts`.
- **`src/shared/`** — types and IPC channel names, imported by both sides, no Node and no DOM.
  `shared/ipc/contract.ts` is the one declarative source of truth for every channel (name, argument
  guard, result type); `CHANNELS` and `ApiaryApi` are derived from it, the preload bridge is
  generated from it, and main's handlers are type-checked against it. See "How to add… an IPC call".
- **`tests/unit`** and **`tests/integration`** run under Vitest in plain Node; **`tests/component`**
  runs the renderer in real Chromium against a fake bridge; **`tests/e2e`** drives the real built
  app with Playwright. Full detail: [`tests/CLAUDE.md`](tests/CLAUDE.md).

| Feature | Main | Shared | Renderer | Tests |
| --- | --- | --- | --- | --- |
| IPC contract | `main/ipc/{registrar,handlers/*}.ts` | `shared/ipc/contract.ts` | `preload/index.ts` (generated) | `unit/ipc*`, `component/*` (via `fakeApiary.ts`) |
| Session discovery/scan | `main/sources/`, `main/scanner/`, `main/sessions/` | `shared/domain/session.ts` | `state/useSessionTreeCache.ts`, `state/useTree.ts` | `unit/sessionScanner.test.ts`, `e2e/sidebar*.spec.ts` |
| Session store (SQLite) | `main/store/` ([CLAUDE.md](src/main/store/CLAUDE.md)) | `shared/domain/session.ts` | — | `integration/sessionStore.test.ts`, `unit/sessionLayoutStore.test.ts`, `unit/sessionLayoutRestore.test.ts` |
| Terminals / PTYs | `main/pty/`, `main/terminals/` ([CLAUDE.md](src/main/pty/CLAUDE.md)) | `shared/domain/pty.ts` | `features/terminal/`, `state/ptyBus.ts` ([CLAUDE.md](src/renderer/CLAUDE.md)) | `unit/screenSnapshot*`, `integration/appService/composer*`, `component/terminal*`, `e2e/terminal*.spec.ts` |
| Windows & tabs, activity, session-following | `main/windows/` | `shared/domain/tabs.ts`, `shared/activity.ts` | `app/App.tsx`, `state/uiState.ts` | `unit/activityFixtures*`, `component/{sessionTabs,multiTerminal}*`, `e2e/{multiWindow,detachTab,sessionFollowing,sessionTabs}.spec.ts` — full doc: [`docs/architecture/windows-and-tabs.md`](docs/architecture/windows-and-tabs.md), [`activity.md`](docs/architecture/activity.md), [`session-following.md`](docs/architecture/session-following.md) |
| Layouts (panes) | — | `shared/` (layout helpers) | `features/layout/layout.ts` ([CLAUDE.md](src/renderer/state/CLAUDE.md)) | `component/paneLayouts*`, `e2e/paneLayouts.spec.ts` |
| Search (FTS5) | `main/search/` ([CLAUDE.md](src/main/search/CLAUDE.md)) | `shared/treeFilter.ts` | `state/useSessionTreeCache.ts` ([CLAUDE.md](src/renderer/state/CLAUDE.md)) | `unit/searchLoad.test.ts`, `component/search*`, `e2e/search.spec.ts` |
| Themes | `main/theme/` | `shared/theme/*` ([CLAUDE.md](src/shared/theme/CLAUDE.md)) | `theme/`, `features/settings/sections/ThemesSectionEntry.tsx` ([CLAUDE.md](src/renderer/CLAUDE.md)) | `unit/theme*`, `component/themes*`, `e2e/{themes,themeGenerator}.spec.ts`, `e2e/bench/themePerf.spec.ts` |
| Session-bar plugins | `main/plugins/` ([CLAUDE.md](src/main/plugins/CLAUDE.md)) | `shared/domain/plugins.ts` | `features/settings/fields/PluginField.tsx` | `integration/pluginBar.test.ts`, `component/gitMenu*`, `e2e/pluginBar.spec.ts` |
| Settings | `main/settings.ts`, `main/ipc/handlers/settings.ts` ([CLAUDE.md](src/main/CLAUDE.md)) | `shared/domain/settings.ts`, `shared/settingsDefaults.ts` | `features/settings/` | `unit/settings*`, `component/settings*`, `e2e/settings.spec.ts` |
| Status bar (plugins; Claude usage) | `main/statusBar/` ([CLAUDE.md](src/main/plugins/CLAUDE.md)) | `shared/domain/statusBar.ts` | `features/statusBar/`, `state/useStatusBar.ts` | `unit/claudeUsage.test.ts`, `unit/statusBarRegistry.test.ts`, `component/statusBar*`, `e2e/statusBar.spec.ts` |
| Updater | `main/update/` ([CLAUDE.md](src/main/update/CLAUDE.md)) | `shared/domain/update.ts` | `features/update/` | `unit/updateService*`, `e2e/update.spec.ts` |
| Diagnostic log | `main/log/` ([CLAUDE.md](src/main/log/CLAUDE.md)) | `shared/redact.ts` | `features/settings/sections/DiagnosticsSection.tsx` | `e2e/diagnostics.spec.ts` |
| git (branch, worktrees, MR status) | `main/git/` | `shared/domain/git.ts` | `features/git/` | `integration/branchOps*`, `integration/worktreeResolver*`, `e2e/{gitToolbar,gitMenu,mrStatus,allWorktrees}.spec.ts` |

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Run the app | `npm start` |
| Build (renderer + main, `out/`) | `npm run build` |
| Typecheck (both tsconfigs) | `npm run typecheck` |
| Lint (5 linters) / autofix | `npm run lint` / `npm run lint:fix` |
| Unit + integration | `npm test` (or `npm run test:unit`, `npm run test:integration` separately) |
| Component (renderer, headless Chromium) | `npm run test:component` |
| E2E (builds first, then Playwright) | `npm run test:e2e` |
| E2E smoke only (~1 min, what CI runs) | `npm run test:e2e:smoke` |
| Packaged-app smoke (opt-in; `electron-builder --dir`, launches the packaged binary; macOS skips unless `codesign --verify` passes; not in CI) | `npm run test:packaged` |
| Watch mode (unit/integration) | `npm run test:watch` |
| Dependency audit gate | `npm run audit` |
| Regenerate README screenshot | `npm run screenshot` |

**Single test per layer** — see [`tests/CLAUDE.md`](tests/CLAUDE.md) for the full version, in
particular why an e2e single-spec command needs `--no-deps`:

```sh
npm test -- tests/unit/x.test.ts                          # unit
npm run test:integration -- tests/integration/x.test.ts   # integration
npm run test:component -- tests/component/x.test.tsx      # component
npm run build && npx playwright test tests/e2e/x.spec.ts --project=parallel --no-deps  # e2e
```

None of the above rebuild a native module — see [`docs/testing.md`](docs/testing.md): the ABI trap
that used to require rebuilding `better-sqlite3`/`node-pty` per runtime is gone (N-API prebuilds).
`npm start`, `npm test` and `npm run test:e2e` all work straight after `npm ci`, in any order, at
the same time.

## Never

- Never push, tag or release without asking the maintainer first.
- Never add AI attribution to a commit message or PR description — the commit-msg hook rejects it.
- Never run `npx vitest`/`npx playwright test` bypassing the npm scripts unless you know exactly
  which config and project you need (see "Single test per layer" above).
- Never let the renderer supply a filesystem path that main acts on (see "Hard rules").

## Definition of done

- `npm run typecheck && npm run lint` pass.
- Tests in the cheapest layer that proves the change, for every area touched: `npm test` for
  main/shared logic, `npm run test:component` for renderer behaviour, the matching `e2e` spec for
  anything that needs the real app (process wiring, multiple windows, a relaunch, native menus).
- Every behaviour change has a test that fails without the change and passes with it.
- Version bumped and a new `CHANGELOG.md` section added (see next section) — every change, not just
  releases.
- Commit message is a Conventional Commit that carries the version.

## Versioning, changelog, commits

**Every change bumps `package.json`'s version and adds its own `CHANGELOG.md` section — never reuse
the current version, and never batch several changes under one bump.** This project publishes every
commit's version, so "I'll bump it later" leaves a released version with no changelog entry. Bump
patch or minor per SemVer; the maintainer decides major bumps.

- Commit subject: `type(scope): X.Y.Z — summary` (Conventional Commits; `commitlint.config.js`
  extends `@commitlint/config-conventional` with a 150-character header limit — the subject is a
  sentence about behaviour, and a clipped one helps nobody).
- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): `### Added`,
  `### Changed`, `### Fixed` (and `### Security` when relevant) under each version heading. A
  version that did not ship to every platform is annotated on its own heading, e.g.
  `## [1.24.2] - 2026-09-26 (Linux only)` or `(not released)` — see `CHANGELOG.md` for examples.
- No AI attribution anywhere in a commit message or PR description (`.husky/commit-msg` rejects
  `Co-Authored-By: ... Claude/Anthropic/...` and `Generated with [Claude`).
- **Ask before pushing, tagging or releasing.** A `v*` tag triggers `.github/workflows/release.yml`;
  the maintainer tests builds by hand first.
- `npm run audit` (`npm audit --audit-level=low`, dev dependencies included — Electron itself is
  one) is a gate in both `ci.yml` and `release.yml`, ahead of build and test. Run it locally before
  tagging too.

## Hard rules (each links to where the reason lives)

- **The renderer never supplies a filesystem path** that main acts on — it resolves paths itself
  from an id it already trusts. → [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md)
- **Working directories come from the session's JSONL `cwd` field**, never the lossy directory name
  under `~/.claude/projects`. → [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md)
- **Git's prose is not an interface** — use `--porcelain` output, never parse an error message.
  → [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md)
- **A pty belongs to main, not a window; never spawn over a live id; a late-attaching view gets a
  rendered snapshot, never a raw byte replay.** → [`docs/architecture/windows-and-tabs.md`](docs/architecture/windows-and-tabs.md)
- **Activity reads the rendered screen, never the raw pty stream; no "looks like a question"
  heuristic; fixtures are recordings, not inventions.** → [`docs/architecture/activity.md`](docs/architecture/activity.md)
- **A rescan never writes `cwd_override` or `project_path`.** → [`src/main/store/CLAUDE.md`](src/main/store/CLAUDE.md)
- **Every layout change goes through `tidyLayout`.** → [`src/renderer/state/CLAUDE.md`](src/renderer/state/CLAUDE.md)
- **A theme is data, never code; `validateTheme` is the only way in; no `backdrop-filter`; no
  literal `border-radius` above 3px in `styles.css`.** → [`src/shared/theme/CLAUDE.md`](src/shared/theme/CLAUDE.md)
- **Settings: a missing field over IPC means "unchanged", never `false`; changing a default needs a
  migration (`SETTINGS_VERSION`).** → [`src/main/CLAUDE.md`](src/main/CLAUDE.md)
- **The diagnostic log never receives conversation content** — not redacted, never passed.
  → [`src/main/log/CLAUDE.md`](src/main/log/CLAUDE.md)
- **A release must ship `latest-*.yml` and keep the macOS `zip` target**, or it is invisible to
  installed copies. → [`src/main/update/CLAUDE.md`](src/main/update/CLAUDE.md)

## How to add…

Each recipe lists the files that must change together and the test to write; they are not
tutorials.

- **An IPC call.** One entry in `src/shared/ipc/contract.ts` (name, argument guard, result type),
  one handler in the matching `src/main/ipc/handlers/*.ts` file (a channel with no handler is a
  compile error, not a runtime "No handler registered" — `registrar.ts` type-checks against the
  contract). `preload/index.ts` and the renderer's `ApiaryApi` type are derived, not edited. Add the
  call to `tests/component/fakeApiary.ts` (it is typed as `ApiaryApi`, so a missing call is a type
  error) — mirror any event main now emits after the call, or component tests pass against
  behaviour the app does not have.
- **A setting.** `AppSettings`/`DEFAULT_SETTINGS` in `main/settings.ts`, the field in the shared
  `AppSettingsPayload` (`shared/domain/settings.ts`) and `DEFAULT_SETTINGS_PAYLOAD`
  (`shared/settingsDefaults.ts`), the `settingsGet` mapping and `mergeSettingsPayload` handling in
  `main/ipc/handlers/settings.ts` / `main/settings.ts`, a control in `SettingsDialog.tsx`'s section
  files, and the field in `tests/component/fakeApiary.ts`. **Changing an existing default** also
  needs `SETTINGS_VERSION` bumped and `migrateSettings` extended — see
  [`src/main/CLAUDE.md`](src/main/CLAUDE.md).
- **A session-bar plugin.** A module in `main/plugins/` implementing the plugin interface
  (`shared/domain/plugins.ts`), registered in `main/plugins/registry.ts`; settings fields (if any)
  use the existing field kinds so the Plugins settings section needs no changes. See
  [`src/main/plugins/CLAUDE.md`](src/main/plugins/CLAUDE.md).
- **A theme token.** An allowlist entry in `shared/theme/spec.ts`, read by `validateTheme`, mapped
  to a CSS custom property in `themeToCssVars`/`cssVars.ts`. Never let a token's value be parsed as
  CSS. See [`src/shared/theme/CLAUDE.md`](src/shared/theme/CLAUDE.md).
- **A theme effect.** `EFFECT_KINDS` in `spec.ts`, the draw function in `shared/theme/effects/`
  registered in `effects/index.ts`'s `EFFECTS`, and a note in `prompt.ts`'s `EFFECT_NOTES` (typed
  `Record<EffectKind, string>`, so a missing one is a type error, not a silent gap).
- **A log line.** Call `log()` (`main/log/logger.ts`) with a short scope (existing ones:
  `session-tracker`, `tabs`, `rename`, `mr-status`, `navigation`) and only data, never conversation
  content — redaction happens inside the logger (`shared/redact.ts`), not at the call site. See
  [`src/main/log/CLAUDE.md`](src/main/log/CLAUDE.md).
- **A component test.** Add it under `tests/component/`, driving the real renderer against
  `fakeApiary.ts`. If the change adds or changes an IPC call, update the fake first (see "An IPC
  call" above) or the test proves nothing.
- **An e2e spec.** Use `launchApiary`/`Harness` from `tests/e2e/helpers.ts`. Tag `@serial` if it
  uses the OS clipboard, window focus, or measures timing; tag `@smoke` only if it belongs in the
  one-minute CI subset through a main path. See [`tests/CLAUDE.md`](tests/CLAUDE.md).

## Conventions

- **Comments explain why, not what.** The density here is higher than most codebases on purpose —
  most comments record a decision, a measurement, or a bug that will otherwise be reintroduced.
  Match it. A comment that restates the line below it is noise; one that says why the obvious
  approach was wrong is the point.
- **`styles.css` uses tokens for colour and shape** — no literal colours or literal control heights,
  paddings, corner radii or focus rings. Controls go through the control layer (`.btn`), not a rule
  of their own. Full story: [`src/renderer/CLAUDE.md`](src/renderer/CLAUDE.md).
- **Tests are written as statements about behaviour**, not about implementation: read a few
  existing names before adding one.
- **A pure helper wanted on both sides of the bridge lives in `src/shared/`**, never in
  `src/main/`. `tsconfig.node.json` has no DOM lib, so a unit test that reaches into a renderer
  module drags it into that project; and the renderer has no Node. `shared/promptPreview.ts` and
  `shared/forkLabel.ts` exist for that reason.
- TypeScript is strict; `npm run typecheck` covers both tsconfigs and both must pass.
- A disable comment (ESLint, Stylelint) is fine when it says why (`-- <reason>`);
  `reportUnusedDisableDirectives` fails the lint once the reason stops applying.

## Environment variables and on-disk state

Every `APIARY_*` test/launch hook is parsed once in `src/main/app/env.ts`'s `parseRuntimeEnv`, and
is `undefined` in a packaged build (`app.isPackaged`) — none of them can be used to redirect a real
install. Full table of every variable and every userData file, with who sets it and what it does:
[`docs/environment.md`](docs/environment.md).

## Measure before fixing

The bugs in this app that took longest were the ones fixed from a plausible explanation instead of
a measurement — a 352px terminal in a 167px row misdiagnosed as a timing bug, a write landing a
second before its program existed. Read the actual state (`apiary.db`, `getBoundingClientRect`, a
`tail` of the pty) before changing code, and say what you measured. Full stories, and the
`sqlite3 -readonly`/`-shm` trap: [`docs/debugging.md`](docs/debugging.md).

## Where the long-form lives

- **Nested `CLAUDE.md` files** (load automatically when you read a file in that directory):
  [`src/main/CLAUDE.md`](src/main/CLAUDE.md), [`src/main/pty/CLAUDE.md`](src/main/pty/CLAUDE.md),
  [`src/main/search/CLAUDE.md`](src/main/search/CLAUDE.md),
  [`src/main/store/CLAUDE.md`](src/main/store/CLAUDE.md),
  [`src/main/update/CLAUDE.md`](src/main/update/CLAUDE.md),
  [`src/main/plugins/CLAUDE.md`](src/main/plugins/CLAUDE.md),
  [`src/main/log/CLAUDE.md`](src/main/log/CLAUDE.md),
  [`src/renderer/CLAUDE.md`](src/renderer/CLAUDE.md),
  [`src/renderer/state/CLAUDE.md`](src/renderer/state/CLAUDE.md),
  [`src/shared/theme/CLAUDE.md`](src/shared/theme/CLAUDE.md), [`tests/CLAUDE.md`](tests/CLAUDE.md).
- **`docs/architecture/`** — topics spanning main and renderer: see its
  [README](docs/architecture/README.md) for the index.
- **`docs/testing.md`**, **`docs/debugging.md`**, **`docs/packaging.md`**, **`docs/environment.md`**
  — the ABI-trap history, troubleshooting, build/packaging internals and the full env-var/on-disk
  state tables, respectively.
- **`docs/adr/`** — short ADRs for decisions where an alternative was tried and rejected.
- **`docs/history/`** and **`docs/superpowers/`** — historical/in-flight specs and plans. Where
  these disagree with the code or this file, the code wins; do not treat their "Global Constraints"
  as current rules.
- **`CONTRIBUTING.md`** — the human-oriented onboarding path (this file is written for agents), and
  the full linter-by-linter breakdown behind the "5 linters" row in "Commands" above.
