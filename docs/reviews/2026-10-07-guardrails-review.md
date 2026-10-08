# Apiary guardrails review: one way to do each thing, enforced

- **Date:** 2026-10-07
- **Reviewed revision:** `d51186b` (version 1.32.3). All `file:line` references are to this revision.
- **Builds on:** [2026-09-26-codebase-review.md](2026-09-26-codebase-review.md) (115 findings, reviewed
  at 1.25.0, actioned in 1.26.0 and 1.28.0).
- **Scope:**
  1. Check that the 2026-09-26 review's fixes are really in the code, and still there after five
     feature releases (1.28.0 → 1.32.3: chat mode, pets, status bar, Claude usage, branch change).
  2. Find what lets an agent take a shortcut or invent a second way of doing something.
  3. Propose the architecture changes, lint rules, tests, hooks and docs that make the established
     way the only way that passes.
- **Method:** five parallel read-only reviews. Four checked Parts A–E of the previous review, one
  per part. The fifth audited the 9.5k lines added since 1.28.0 for drift, using `git diff
  aafd86f..HEAD`, symbol counts at both revisions and `jscpd`. The lead then re-checked every claim
  in §3 against the code by hand. `npm run typecheck`, `npm run lint`, `npm run test:unit` (1,035
  tests) and `npm run audit` all pass at this revision.

## Contents

1. [Headline](#1-headline)
2. [Did the 2026-09-26 review land?](#2-did-the-2026-09-26-review-land)
3. [Bugs and risks found on the way (fix first)](#3-bugs-and-risks-found-on-the-way-fix-first)
4. [What the drift since 1.28.0 teaches](#4-what-the-drift-since-1280-teaches)
5. [Guardrails: the design](#5-guardrails-the-design)
6. [Guardrails: the concrete checks](#6-guardrails-the-concrete-checks)
7. [Architecture changes that make the guards possible](#7-architecture-changes-that-make-the-guards-possible)
8. [Agent harness and documentation](#8-agent-harness-and-documentation)
9. [Skills: what exists, what to use, what to add](#9-skills-what-exists-what-to-use-what-to-add)
10. [Roadmap](#10-roadmap)

## 1. Headline

**The previous review mostly landed, and where it was enforced by a machine it held.** No claim in
its §7 reply is false. Every change that a compiler, a linter or a test enforces survived five
feature releases written by agents:

- the IPC contract (`shared/ipc/contract.ts` plus the registrar);
- the `APIARY_*` gate in `main/app/env.ts`;
- tokenised colours, radii and z-index in CSS;
- the shared-purity lint;
- the unit/integration purity test;
- the HTML sanitiser allowlist.

**Rules that lived only in prose or in a helper's existence did not hold.** New code went around
seven of them:

- `fireAndForget` was never used, and the number of empty `.catch(() => {})` handlers went from 25
  to 38.
- `pets/petStore.ts` copies `writeJsonAtomic` instead of calling it.
- Two new login-shell spawners sit outside `main/exec/`.
- A new drag handle does not use `useResizeDrag`.
- Seven new inline SVGs sit outside `ui/icons`.
- Two new `role="menu"` widgets have no keyboard support.
- Several features each subscribe to the bridge themselves instead of using a shared store.

The pattern is consistent: **an agent copies the nearest example and takes the shortest path that
compiles.** A helper that exists but is not mandatory is, to an agent, one option among several.

So the work this report proposes is mostly not new architecture. It is:

1. **Turn each "sanctioned way" into a check whose error message names the fix.** That means ESLint
   `no-restricted-imports` and `no-restricted-syntax` packs, a dependency-direction checker, a
   duplicate-helper scanner, and contract and registry tests. Each check starts with a baseline
   (ESLint 10's bulk suppressions), so it fails only on new violations from day one (§6).
2. **Close the few architecture gaps that leave agents no single right place to put code.** The
   renderer has no data-access layer: there are 163 direct `window.apiary` calls in 43 component
   files and 7 copy-shaped "fetch + subscribe" hooks. There is no versioned JSON store, and
   `AppService` still takes orchestration code (§7).
3. **Put the checks where agents get feedback fastest.** That means a Claude Code `PostToolUse`
   hook that lints the edited file, a `Stop` hook, and generators for the common recipes. It also
   means a root `CLAUDE.md` that pairs every rule with what enforces it and drops rules nothing
   enforces (§8).

There are also **eight bugs or risks to fix first** (§3). The most important: a chat permission
prompt steals focus, so the Enter that sends your message can approve a tool. Native terminal
paste skips the bracketed-paste stripping. The Claude-usage plugin reads Claude Code's OAuth token
by default, with no consent step.

## 2. Did the 2026-09-26 review land?

### 2.1 Totals

| Part | Findings | Verified as claimed | Partial beyond what was disclosed | Regressed since 1.28.0 |
| --- | --- | --- | --- | --- |
| A Security | 13 | 10 | SEC-6 | — |
| B Main | 26 | 17 | MAIN-1, MAIN-6, MAIN-13, MAIN-15, MAIN-16, MAIN-23 | MAIN-14 (trend), MAIN-19 (chat spawn) |
| C Renderer | 33 | 19 | UI-3, UI-6, UI-8, UI-16, UI-23, UI-24 | UI-26, UI-27, UI-32 (new code) |
| D Tests and tooling | 19 | 16 | TEST-3, TEST-5 (scope) | TEST-18 (`three`) |
| E Docs, shared, structure | 24 | 17 | DOC-1, DOC-2, DOC-4, DOC-6, DOC-8, DOC-10, SHARED-3 | STRUCT-4 (imports) |

"Verified" includes the items the maintainer already marked *Partly done* where the remaining gap
is exactly the one disclosed. No reply claim was false. Some claim texts are out of date: SEC-9
says `--end-of-options`, which was removed in 1.27.0 for git < 2.44 and replaced by
`assertNotOption` plus a trailing `--`. SEC-1 says plain `npm audit`; it is now `scripts/audit.mjs`
with two dated allowlist entries. SEC-10 points at `src/main/permissions.ts`, which moved to
`app/permissions.ts`.

### 2.2 Items that need action

| ID | State now | Evidence | Action |
| --- | --- | --- | --- |
| SEC-6 | Composer, Cmd/Ctrl+V and context-menu Paste strip bracketed-paste terminators. A native `paste` event on xterm's textarea does not. That covers Edit > Paste (`main/app/menu.ts:69` `role: 'editMenu'`), Shift+Insert and Linux middle-click. xterm 6 brackets the text but keeps ESC | `shared/pasteSafe.ts:14`, `features/terminal/terminalPaste.ts:22`; no `paste` listener on the terminal | Intercept `paste` on the terminal element (capture phase) and route it through `terminalPaste`. Component test with a `ClipboardEvent` containing `\x1b[201~` |
| MAIN-1 | A scoped pass hits the resolver cache, so an external `git checkout` is not shown until a full pass. Every pass still spawns `ps` and stats every session for search | `sessions/sessionCatalog.ts:265,298`, `search/indexer.ts:78-98`, `searchService.ts:170` | Invalidate the resolver entry for a project whose `.git/HEAD` changed. Run `detectLiveSessions` on its own timer, not per pass. Scope the search pass to changed files |
| MAIN-6 | Leak fixed, but `onExit` is not identity-checked: a late exit of a killed child wipes a respawned entry with the same id. 9 parallel maps remain | `pty/ptyManager.ts:116-130` | Do the `PtyEntry` consolidation, and compare the `IPty` instance in `onExit` |
| MAIN-14 | Trending back: `appService.ts` 541 → 667 lines, 62 → 74 methods since 1.28.0. Chat orchestration and pets' `latestActions` went in | `appService.ts:149-156,433,456,472` | §7.3 `ChatService`, plus the "delegates only" test in §6.4 |
| MAIN-15 | "`createContainer` is the one construction site" is not true: `AppService` builds 12 collaborators, `ClaudeProjectsSource` is built twice, and the watcher starts from `registerIpc` | `app/container.ts:12-21` | §7.3, then the `new X()` lint in §6.1 |
| MAIN-19 | The chat child has no `'error'` listener. A failed spawn throws in main, and `exited` never resolves, so `stopAll` can hang the deferred quit | `chat/chatManager.ts:46`, `chat/chatSession.ts:50-60` | Listen for `'error'` and resolve `exited` from it. Unit test with a spawn that emits `error` |
| MAIN-23 | Bypasses of `exec/run.ts`: `update/electronUpdaterBackend.ts:65`, `statusBar/claudeUsage/credentials.ts:44`, `update/macSignature.ts:18`, plus new streaming spawns in `claude/claudeOneShot.ts:82` and `chat/chatManager.ts:17` | grep `node:child_process` | §7.5 `spawnLoginShell`, plus the import allowlist in §6.1 |
| UI-3 / UI-10 | `window.apiary.tree()` still called directly at `App.tsx:291,313,554,565,573`, `useLaunchRestore.ts:60` and new `useChatTakeover.ts:23`. `onTreeChanged` subscribed in 8 places plus once per `Transcript` | grep | §7.1 renderer data layer |
| UI-23 | `ui/fireAndForget.ts` has 11 call sites in 2 files. About 13 IPC promises have no catch, and 15 `.catch(() => {})` swallow errors silently, including user actions in `PetLayer.tsx:303,311,316` | see §4 | §6.1 empty-catch rule; one documented error policy |
| UI-24 | No ErrorBoundary around `BranchSwitcher`, `NewWorktreeDialog`, `FolderBranchDialog`, `PetLayer`, `StatusBar`, `UpdateBanner`, `TitleBar`, `ThemeEffects`. A throw in any of them blanks the window | `App.tsx:612-823` | Wrap each top-level sibling. Add a test that every child of the root layout is inside a boundary |
| UI-26 / UI-27 / UI-32 | Regressed in new UI: `chat/ModeMenu.tsx:62` and `chat/ModelPicker.tsx:48` declare `role="menu"` with no keyboard handling. The Composer resizer is pointer-only (`Composer.tsx:266-279`). Pets are `role="button"` with no `tabIndex`. There are 7 new inline SVGs | | §7.6 UI primitives, plus the lints in §6.1 |
| TEST-3 | Coverage is configured but CI never runs or publishes it | `ci.yml` | §6.6 |
| TEST-5 | The contract suite covers none of the chat, pets, update, theme, tab or branch-change channels, so the fake can drift there | `tests/contract/bridgeContract.ts` | §6.4 "every channel has a contract case or an exemption" test |
| TEST-18 | `three` (22 MB) is in `dependencies` and imported only by `features/pets/render3d/*`, so it is packed into the asar again | `package.json:46` | Move it to `devDependencies`. Add the §6.4 dependency-placement test |
| STRUCT-4 | Six newer tests import `../../src/shared/...` instead of `@shared/*` | `tests/unit/chatProtocol.test.ts` and others | `no-restricted-imports` pattern `**/src/shared/**` in tests |
| SHARED-3 | `'transcript' \| 'terminal'` is inline again in `shared/layoutReport.ts:17`, `columns.ts:17` and `ResumeBar.tsx:6,8`. `LogScope` lacks `'pets'`, which main logs ten times | | Use `TabView`. Type `log()`'s scope as `LogScope` so a new scope is a compile error |
| DOC-1/2/4/6/8/10 | Root `CLAUDE.md` is 246 lines against a target of ~150. Stale facts are listed in §8.2. There has been no ADR since 0010, although chat, pets and Claude usage each made rejected-alternative decisions | | §8 |

## 3. Bugs and risks found on the way (fix first)

The lead re-checked each of these against the code.

1. **A chat permission prompt can be approved by accident.** `features/chat/PermissionCard.tsx:17`
   focuses "Yes" on mount (and `:33` sets `autoFocus`). A prompt that arrives while you are typing
   in the Composer takes focus, so the Enter that was meant to send your message allows the tool.
   *Fix:* take focus only if the Composer is not focused, or require a key that is not Enter.
   *Test:* component test that types in the Composer, pushes a permission request, presses Enter,
   and asserts that no `chatDecide` call was made.
2. **Native paste into a terminal skips SEC-6's stripping** (§2.2).
3. **The Claude-usage plugin is on by default and reads Claude Code's OAuth token.** It reads the
   token from the macOS Keychain or `.credentials.json` and sends it as a Bearer token to
   `api.anthropic.com/api/oauth/usage`, an undocumented endpoint behind a beta header
   (`statusBar/claudeUsage/plugin.ts:117` `defaultEnabled: true`, `credentials.ts:44`, `limits.ts:22`).
   The first launch triggers a Keychain read with no consent step. `shared/redact.ts`'s header
   still says Apiary holds no credential of its own. *Fix:* default it off, or ask once. Update the
   redact header. Write an ADR for the decision.
4. **The chat child process has no `'error'` listener**, which can hang quit (MAIN-19 above).
5. **`src/main/plugins/registry.ts:147` contains a raw NUL byte** (`${ctx.cwd}\0${ctx.branch}` was
   written literally instead of as an escape). `git diff` and `grep` treat the file as binary, so
   changes to it do not show up in review. *Fix:* write `\0` as an escape. *Guard:* §6.5
   "no control bytes in source".
6. **Duplicate `@keyframes chat-pulse`** (`styles/33-chat.css:102` and `:419`). The later one wins,
   so the pending tool dot grows and fades instead of pulsing. *Guard:* §6.5 duplicate-keyframes
   check.
7. **The IPC sender check fails open** when `senderFrame` is `null`/`undefined`
   (`ipc/ipcSenderGuard.ts`). Electron sets it to `null` for a destroyed frame. Deny by default,
   and allow a missing frame only in the test harness.
8. **Stale-response and duplicate-subscription bugs in new hooks.** `features/pets/usePets.ts:9-10`
   and `features/update/useUpdate.ts:16-17` can overwrite a newer pushed value with an older
   initial fetch. `useChat` is called twice per pane (`SessionHeader.tsx:24`, `SessionBody.tsx:33`),
   so every chat push (about every 40 ms while streaming) reaches 2N+1 closures. §7.1 fixes all of
   these at once.

Smaller items:

- `ChatManager.sessions` never drops an exited session (`chat/chatManager.ts:29`).
- `chatChanged` broadcasts the full `ChatState` to every window every 40 ms with no per-window
  scoping. `windows/ptyAttachments.ts` is the model to copy.
- `ImportDialog`'s width drag writes UI state on every mousemove, despite the comment in
  `useUiState.ts:46`.
- Test seams `__apiaryPetBrainOptions` (`pets/brainClient.ts:16`) and `__apiaryPetsFlat`
  (`render3d/usePetImages.ts:150`) ship in production.
- `ClaudeOneShot` passes the prompt with no `--` before it (`claude/claudeOneShot.ts:70-75`).
- `readImage` confines paths with `resolve`, not `realpath` (`media/imageStore.ts:58`).
- `useHabitat` runs a 1 s DOM poll forever while pets are out (`pets/useHabitat.ts:50`).
- `PetLayer` polls `petClaudeActions` every 10 s although main already pushes activity.
- `WorkingLine` is an `aria-live` region whose text changes every second.
- `chat/startMode.ts` defaults chats to `auto` permission mode. This is deliberate, but it is a
  different default from terminals, so record it in an ADR.

## 4. What the drift since 1.28.0 teaches

The table pairs each rule with what enforced it in 1.28.0 and what happened in the 9.5k lines that
followed. Counts are from `git grep` at `aafd86f` and `d51186b`.

| Rule | Enforced by | Held? | Evidence |
| --- | --- | --- | --- |
| Every IPC channel in `contract.ts`; handlers type-checked | types + registrar | **Yes**: 22 new channels, 0 bypasses | |
| `APIARY_*` hooks only via `env.ts`, inert when packaged | single parser + review | **Yes**: 4 new hooks, all in `env.ts` | |
| No literal colours, radii, z-index in CSS | stylelint | **Yes**: 0 in `33-chat.css`, `70-pets.css` | |
| Shared code has no Node/DOM | ESLint `no-restricted-*` in `src/shared` | **Yes**: `shared/pets`, `chatTimeline` pure | |
| No `any`, no `!`, disables carry a reason | TS strict, `reportUnusedDisableDirectives` | **Yes**: `any` 6 → 6, `!` 2 → 2 | |
| No fire-and-forget without logging (`fireAndForget`) | prose (`CLAUDE.md`, helper exists) | **No** | uses 14 → 14; empty-body `.catch` 25 → 38 |
| Persisted JSON via `writeJsonAtomic` | prose (helper exists) | **No** | `pets/petStore.ts:65-70` copies `theme/themeStore.ts:90-95` |
| Subprocesses via `main/exec/run.ts` | prose | **No** | `chat/chatManager.ts:17`, `claude/claudeOneShot.ts:82` |
| Drag resizing via `useResizeDrag` | prose | **No** | `transcript/Composer.tsx:107-133` |
| Icons in `ui/icons` | prose | **No** | 7 new inline SVGs (`chat/ModeMenu.tsx:22-36`, `statusBar/StatusBar.tsx:13,23`, ...) |
| `role="menu"` keeps its keyboard contract (`ui/Menu.tsx`) | prose | **No** | `chat/ModeMenu.tsx`, `chat/ModelPicker.tsx` |
| Bridge events through one shared store per kind | prose (UI-10) | **No** | `useChat` ×2 per pane, `usePets` ×2, `StatusBar.tsx:69` |
| New behaviour in services, `AppService` a facade | prose (`src/main/CLAUDE.md`) | **No** | +126 lines of chat orchestration |
| "No literal control heights or paddings" | prose (`src/renderer/CLAUDE.md`) | **No**, and never was | ~140 literal `padding: Npx` in total, 20 new in `33-chat.css` |
| Branded `SessionId`/`PtyId` from the source | types, but `ChatState.sessionId: string` | **Partly** | `asSessionId(` casts in renderer 8 → 16 |

Two more observations shape the design:

- **Duplication is semantic, not textual.** `jscpd` finds 0.51% verbatim duplication, but the same
  helper is defined many times: `isModel` ×3 (plus one inline copy), `own` ×2, a UUID regex ×3,
  `shellQuote` ×2, a control-character strip ×4, `clamp` 5 named copies plus 53 inline
  `Math.min(Math.max(`, and `e instanceof Error ? e.message : String(e)` 16 → 21 times. There are 7
  near-identical "initial fetch + push subscription" hooks, 6 outside-click handlers, 5 drag
  resizers and 3 tree flatteners. A token-clone gate would not catch this. A
  duplicate-symbol-name scan would.
- **A rule that the docs state but nothing enforces teaches agents that rules are optional.** The
  "no literal paddings" line is broken 140 times. An agent that reads it, then reads the CSS, learns
  that `CLAUDE.md` is aspirational. Either enforce a rule or delete it.

## 5. Guardrails: the design

### 5.1 Principles

These follow the repo's own [`correct` skill](../../.claude/skills/correct/SKILL.md), which already
states the ladder. This report applies it to every drift class above.

1. **Fix at the highest level that works:**
   - architecture (one owner, one place);
   - types (make the bad state unwritable);
   - a check whose error message names the fix;
   - a behaviour test;
   - a prose rule, last.
2. **Every check fails only on new violations from day one.** Existing violations go into a
   committed baseline that can only shrink: ESLint 10 bulk suppressions
   (`eslint --suppress-rule <rule>` writes `eslint-suppressions.json`, and `--prune-suppressions`
   removes fixed entries), and dependency-cruiser's known-violations file. A rule never lands as a
   `warn` that nobody reads. It lands as an `error` with a baseline.
3. **The error message is the documentation.** Each message says what to use instead and where it
   lives, for example: "Use `writeJsonAtomic` from `src/main/fs/` (or the versioned `JsonStore`).
   Raw fs writes lose user data on a crash." An agent fixes what the message tells it to.
4. **Exceptions are visible.** An exception is either an inline disable with `-- <reason>` (already
   enforced by `reportUnusedDisableDirectives`) or an allowlist entry in the config next to the
   rule. Allowlists live in code, not in docs.
5. **Each rule in `CLAUDE.md` names its enforcer.** A rule with no enforcer goes into a separate
   "judgment calls" list, so agents can tell the two kinds apart (§8.1).
6. **Agents get feedback in the loop, not at push time.** Lint runs on the edited file right after
   each edit (a Claude Code hook). The pre-push hook and CI are the backstop.

### 5.2 Where each class of drift is stopped

| Drift class | Architecture (§7) | Types | Check (§6) | Test (§6.4) |
| --- | --- | --- | --- | --- |
| Silent error swallowing | one error policy: `fireAndForget(p, scope)` / `notifyError` | — | empty-catch selectors; `no-floating-promises` without `ignoreVoid` for bridge calls | — |
| Persisted state | versioned `JsonStore` in `main/fs/` | `JsonStore<T>` requires `version` + `migrate` | `node:fs` write functions restricted outside `main/fs/` | every store registered and migration-tested |
| Subprocesses | `exec/run.ts` + new `spawnLoginShell` | — | `node:child_process` allowlist | — |
| Bridge access in renderer | data layer: `state/` stores from one factory | — | `window.apiary` restricted outside `state/` (baseline) | — |
| IPC argument looseness | contract guards in `shared/` | strict `invoke` vs explicit `invokeLoose` | `as unknown as` banned in handlers | loose channels and path-carrying args are allowlisted |
| Helper re-invention | `shared/guards.ts`, `shared/errors.ts`, `ui/` primitives | — | duplicate-symbol scanner; named-symbol bans | — |
| God files | `ChatService`, `PluginService`, workspace context split | — | `max-lines` ratchet, `max-lines-per-function` | `AppService` methods delegate only |
| Layer violations | layers in §6.2 | — | dependency-cruiser | — |
| Fake drift | — | `fakeApiary: ApiaryApi` | — | every channel has a contract case or exemption |
| Packaging | — | — | — | dependency placement; fuses read from the packaged app |

## 6. Guardrails: the concrete checks

All rules below are written so they can be added to `eslint.config.js` today. **Flat-config trap:**
a later config block that sets `no-restricted-imports` *replaces* an earlier block's options for
the same files; it does not merge them. Build each scope's options from one helper (for example
`restrict({ paths, patterns })`, which always includes the base renderer/main/shared patterns) so
that adding a restriction cannot silently drop an older one. Add a unit test that loads the config
through ESLint's `calculateConfigForFile` and asserts the base patterns are present for one file in
each scope.

### 6.1 ESLint packs

**Main process** (`src/main/**`):

| Rule | Selector / option | Allowed in | Message (abridged) |
| --- | --- | --- | --- |
| No raw subprocess | `no-restricted-imports` `node:child_process` | `main/exec/**`, `main/pty/**`, the new `spawnLoginShell` module | "Short-lived: `createExec` (`main/exec/run.ts`). Long-lived claude/shell: `spawnLoginShell`. Never `shell: true`." |
| No raw state writes | `no-restricted-imports` `node:fs` and `node:fs/promises` with `importNames: [writeFileSync, writeFile, renameSync, rename, appendFileSync]` | `main/fs/**`, `main/log/logger.ts`, `main/media/imageStore.ts`, `main/pty/promptPath.ts` | "Persisted state: `JsonStore` / `writeJsonAtomic` in `main/fs/`." |
| No direct `ipcMain`, `webContents.send` | `no-restricted-imports` `electron` `importNames: ['ipcMain']`; `no-restricted-syntax` `CallExpression[callee.property.name='send'][callee.object.property.name='webContents']` | `main/ipc/registrar.ts`, `main/ipc/handlers/theme.ts` (sync channel), `main/windows/broadcast.ts`, `main/windows/ptyAttachments.ts` | "Channels go in `shared/ipc/contract.ts`; send with `broadcast`." |
| Construction in the composition root | `no-restricted-syntax` `NewExpression[callee.name=/^(PtyManager\|SessionStore\|SearchIndex\|ChatManager\|PetService\|ClaudeOneShot\|SessionWatcher\|ClaudeProjectsSource)$/]` | `main/app/container.ts`, tests | "Long-lived objects are built in `createContainer` and injected." |
| No casting through `unknown` in handlers | `no-restricted-syntax` `TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']` | — (scope `main/ipc/handlers/**`) | "Write an `isX` guard in `shared/` and use it in `contract.ts`." |

**Renderer** (`src/renderer/**`):

| Rule | Selector / option | Allowed in | Message (abridged) |
| --- | --- | --- | --- |
| Bridge only from the data layer | `no-restricted-syntax` `MemberExpression[object.name='window'][property.name='apiary']` | `renderer/state/**`, `renderer/ui/fireAndForget.ts` (baseline the 163 existing call sites) | "Components read and act through `state/` stores/hooks; see `state/CLAUDE.md`." |
| No polling in features | `no-restricted-syntax` `CallExpression[callee.name='setInterval']`, `CallExpression[callee.property.name='setInterval']` | `renderer/state/**`; animation clocks via disable with reason | "Use a push event or a `state/` store with one shared timer (`mrStatusStore`)." |
| No raw storage | `no-restricted-globals` `localStorage`, `sessionStorage`, `indexedDB` | `state/uiState.ts`, `theme/**`, `features/pets/render3d/usePetImages.ts` | "Persist UI state through `state/uiState.ts`." |
| Icons from `ui/icons` | `no-restricted-syntax` `JSXOpeningElement[name.name='svg']` | `renderer/ui/icons/**`, `features/pets/**` (art) | "Add the icon to `ui/icons` and import it." |
| Dialogs through `Modal`, menus through `Menu` | `no-restricted-syntax` `JSXAttribute[name.name='role'][value.value=/^(dialog\|menu\|listbox)$/]` | `ui/Modal.tsx`, `ui/Menu.tsx`, the new `ui/Listbox.tsx` | "A role promises keyboard behaviour; use the `ui/` primitive that implements it." |
| Drag through `useResizeDrag` | `no-restricted-syntax` `CallExpression[callee.property.name='setPointerCapture']` and `addEventListener` with `'mousemove'`/`'pointermove'` | `ui/useResizeDrag.ts` (moved from `features/layout/`), `ui/useHoverCard.ts` | "Use `useResizeDrag` (keyboard, body class, one commit on release)." |
| Branded ids at the source | `no-restricted-imports` `@shared/domain/ids` `importNames: ['asSessionId','asPtyId']` | `state/**`, `features/workspace/**` | "Carry a branded id from where it is created; do not cast at the call site." |

**Everywhere in `src/**`:**

| Rule | Selector / option | Message (abridged) |
| --- | --- | --- |
| No silent catch | `no-restricted-syntax` `CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.body.type='BlockStatement'][arguments.0.body.body.length=0]` and `CatchClause[body.body.length=0]` | "Use `fireAndForget(p, scope)` or `notifyError`. Never swallow silently. If it really is best-effort, disable with a reason." |
| `void` is not a catch | `@typescript-eslint/no-floating-promises` with `ignoreVoid: false` for `window.apiary.*` (via `allowForKnownSafeCalls` for the safe ones) | "Wrap it in `fireAndForget`." |
| One error-message helper | `no-restricted-syntax` `ConditionalExpression[test.operator='instanceof'][test.right.name='Error']` | "Use `errorMessage(e)` from `@shared/errors`." |
| Reasons on disables | `@eslint-community/eslint-comments/require-description` | (7 older disables lack one) |
| Size ratchet | `max-lines` 400 (renderer components) / 500 (main), `max-lines-per-function` 120, with per-file overrides at today's size for files already over | "Split it; see the split recipes in `CLAUDE.md`." |

**Tests:**

| Rule | Selector / option | Message (abridged) |
| --- | --- | --- |
| No hand-written sleeps | `no-restricted-syntax` `NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']` | "Use `vi.waitFor`, `expect.poll` or a fake clock." (24 today; one is 5 s) |
| `@shared` alias | `no-restricted-imports` pattern `**/src/shared/**` | "Import `@shared/...`." |

### 6.2 Dependency direction (replace `madge` with dependency-cruiser)

`madge --circular` checks only cycles. dependency-cruiser also checks cycles, and adds
direction rules and a committed baseline (`.dependency-cruiser-known-violations.json`). Rules:

- **Main layers:** `app/` → `ipc/handlers/` → services (`sessions/`, `terminals/`, `git/`,
  `chat/`, `pets/`, `settings/`, `search/`, `plugins/`, `statusBar/`) → infra (`store/`, `pty/`,
  `exec/`, `fs/`, `scanner/`, `windows/`, `log/`). An arrow means "may import". Nothing imports
  upward. Two violations exist today: `update/createUpdater.ts` and `sources/claudeProjects.ts`
  import from `app/` or `ipc/`.
- **Handlers are adapters:** `ipc/handlers/**` may not import `node:fs`, `electron`'s `dialog`, or
  infra directly. `handlers/pets.ts` does today (`readFileSync`, `writeFileSync`, dialogs). Move
  that into `PetService`.
- **Renderer layers:** `app/` → `features/*` → `state/`, `ui/` → `@shared`. `ui/` and `state/`
  never import `features/`.
- **Features talk through a public face:** a feature may import another feature's `index.ts`
  only, never its internals. There are 48 cross-feature deep imports today, 23 of them from
  `features/pane`; baseline them.
- **No orphans:** a source file nothing imports, other than entry points and workers, fails.

### 6.3 Duplicate-helper scanner (custom, about 80 lines)

`tests/unit/architecture/duplicateSymbols.test.ts` would use the TypeScript compiler API over
`src/**`:

1. Collect every top-level `function` and `const` declaration (exported or not) with its name
   and a normalised body hash, where identifiers and literals are replaced by placeholders.
2. Fail when a **name** appears in more than one file. Exceptions: names in an allowlist (React
   component names, `default*` test seams), and pairs listed in `duplicateSymbols.allow.json`
   with a reason.
3. Fail when a **body hash** of 5 or more statements appears twice. This catches renamed copies,
   which jscpd misses.
4. Print the message: "`isModel` is already defined in `shared/pets/state.ts`. Import it, or add
   the pair to the allowlist with a reason."

On today's code this flags `isModel`, `own`, `UUID`, `shellQuote`, `clamp*`, `flatten`,
`ROW_SELECTOR`, `MODEL_LABELS` and `defaultExec` ×5. Seed the allowlist with what exists, then fix
it down. Pair it with the new homes: `shared/guards.ts` (`isRecord`, `finite`, `oneOf`, `own`,
`clamp`), `shared/errors.ts` (`errorMessage`), `shared/domain/ids.ts` (`UUID_RE`, `isSessionId`),
`shared/treeWalk.ts` (from §3.2 of the previous review, never created).

### 6.4 Architecture and registry tests (fitness functions)

Each is a unit test under `tests/unit/architecture/`. That puts it in pre-push and CI, and makes
it fast.

| Test | Asserts | Catches |
| --- | --- | --- |
| `contractCoverage` | every key of `IPC` in `contract.ts` has a case in `tests/contract/bridgeContract.ts`, or is in an exemption list with a reason | fake drift in chat, pets, update, theme and tabs (TEST-5 gap) |
| `looseGuards` | every channel whose guard uses `obj`/`any` is declared with `invokeLoose`, and the list matches an allowlist | `petUpdate`/`petVoice` style looseness |
| `pathArgs` | channel argument names matching `/path\|file\|cwd\|dir/` are in an allowlist with the main-side validator named | a new channel that lets the renderer supply a path (hard rule 1) |
| `persistedStores` | every userData file in `container.ts` is opened through `JsonStore` with a `migrate` that is tested for `version: 0` and an unknown future version | `pets.json` writing `version: 1` that nothing reads |
| `appServiceDelegates` | each `AppService` method body is a single delegation, apart from an allowlist that shrinks | orchestration creeping back into the facade |
| `dependencyPlacement` | every package in `dependencies` is imported from `src/main` or `src/preload`; renderer-only packages are `devDependencies` | `three` (TEST-18 regression) |
| `errorBoundaries` | every direct child of the root layout in `App.tsx` and every `DialogHost` entry is inside an `ErrorBoundary` (AST check) | UI-24 gaps |
| `docRefs+` | extend `scripts/check-doc-refs.mjs` to check backticked **symbols** (`registry.ts`, `setLayout`) and `[text](path)` link targets, not only paths, and add `docs/adr/**` | stale recipes (§8.2) |
| `noControlBytes` | no source file contains NUL or other C0 control bytes except tab and newline | `plugins/registry.ts:147` |
| `cssKeyframes` | no `@keyframes` name is defined twice across `styles/*.css` | `chat-pulse` |

### 6.5 Stylelint

- Add a baselined `declaration-property-unit-disallowed-list` for `padding*`, `height`, `min-height`
  and `gap` in `px`, so control sizes go through tokens. Otherwise, delete the "no literal
  paddings or heights" sentence from `src/renderer/CLAUDE.md`. Choose one; leaving the rule
  written but unenforced is the worst option.
- Add a check that chat's own button classes (`.chat-icon-button`, `.chat-mode-button`,
  `.chat-model-pill`, `.chat-menu-option`) are in an allowlist, so a new control goes through
  `.btn`.

### 6.6 CI

- Run `test:coverage` and `test:component:coverage` in CI and publish the summary. Then set
  per-directory thresholds at today's numbers (a ratchet), so coverage can only go up.
- Run the full e2e suite on `main` nightly on Linux and macOS, not only `@smoke` on Linux. Chat,
  pets, update and external-link specs run nowhere automatically today.
- Add a packaged check that reads the fuses (`npx @electron/fuses read --app <path>`) and launches
  the packaged app with `APIARY_CONFIG_ROOT` set, asserting that it is ignored.
- Run `knip` for unused files, exports and dependencies (23 dead exports were added since 1.28.0)
  and `npm run lint:arch` (dependency-cruiser) in the `lint` job.

## 7. Architecture changes that make the guards possible

A lint rule that says "use X" needs X to exist and to be the obvious, complete choice. These are
the places where it does not. Each change lists the guard it unlocks.

### 7.1 A renderer data layer (biggest gap)

**Today:** components call `window.apiary` directly (163 calls in 43 files). Seven hooks repeat
"fetch once, subscribe to a push, guard against stale responses" with different degrees of
correctness: `usePets`, `useUpdate`, `usePtySessions`, `useStatusBar`, `useChat`, `useActiveTabs`
and `useAppSettings`. Two of them have the stale-overwrite bug. `useChat` and `usePets` subscribe
once per caller. Five components each reinvent the "latest request wins" guard.

**Change:** one factory in `state/createIpcStore.ts`:

```ts
// One subscription and one in-flight fetch per store, shared by every caller; ordered so a push
// newer than the fetch is never overwritten. Exposes `useStore(selector)` (useSyncExternalStore).
export function createIpcStore<T>(opts: {
  fetch: () => Promise<T>
  subscribe: (push: (next: T) => void) => () => void
  equal?: (a: T, b: T) => boolean
}): IpcStore<T>
```

Then `chatStore` (keyed by session, like `ptyBus`), `petsStore`, `updateStore`, `statusBarStore`,
`settingsStore` and `activeTabsStore`. The existing `treeStore`, `ptyBus` and `mrStatusStore` move
onto the same shape. Actions (`petUpdate`, `chatSend` and the rest) are exported from the same
modules and wrapped with the error policy, so a component never holds a raw promise.

**Unlocks:** the `window.apiary` restriction (§6.1), the `setInterval` ban, and the removal of the
`.catch(() => {})` sites. It also fixes §3 item 8 and the 2N+1 chat fan-out.

### 7.2 Split the workspace context

`useWorkspace()` is one context, read inside every pane (`useSessionKeys.ts:19`,
`useShellTerminals.ts:46`), so each dispatch re-renders every `SessionColumn` and defeats its
`memo`. Expose the reducer state through a store with selectors
(`useWorkspaceSelector(s => s.panes[id])`), or split it into layout, tabs and pending contexts.
Extend `tests/component/appPropStability.test.tsx` so a tab activation in pane A causes no render
in pane B.

### 7.3 Main: finish the service split

- **`ChatService`**: move `chatStart` (take-over, kill, cwd check, permission default),
  `chatAdoptions`/`adoptChatSessions` and `terminalBusy` out of `AppService`. The service owns the
  `ChatManager` and broadcasts only to windows that show that chat. Copy
  `windows/ptyAttachments.ts`, and send deltas or throttled snapshots, not the whole `ChatState`
  every 40 ms. Drop exited sessions.
- **`PluginService`**: the plugin and status-bar registries leave `AppService`, which completes
  §3.1 of the previous review.
- **Composition root:** `createContainer` builds every long-lived object, including
  `ChatManager`, the IPC-layer stateful objects, one `ClaudeProjectsSource`, and the watcher (moved
  out of `registerIpc`). The module-level singletons (resolver cache, MR cache, `execGit`,
  transcript cache) become instances injected through the container. That deletes
  `setExecForTesting` and the `clear*Cache` test hooks.
- **`AppService`** ends as delegates only, enforced by the `appServiceDelegates` test. The
  facade can then be removed: handlers take services directly.

### 7.4 One versioned JSON store

Add `main/fs/jsonStore.ts`: `JsonStore<T>({ file, version, validate, migrate, fallback })`, with
an atomic write that calls `fsync` (the helper's doc promises "power loss" but no write calls
`fsync`). Port `settings.ts`, `windows/sessionLayoutStore.ts`, `theme/themeStore.ts` and
`pets/petStore.ts` onto it. That removes three copies of the write and five ways of
"read JSON with a default", and makes `version` meaningful for `pets.json` and `themes.json`.

**Make settings single-source while you are there.** A new setting still touches 6 to 8 files.
Declare each setting once in `shared/settings/schema.ts`: key, type guard, default, migration
note, and the section and control kind it shows under. Derive `AppSettingsPayload`,
`DEFAULT_SETTINGS_PAYLOAD`, `mergeSettingsPayload` (per-field type check, which also closes the
`keep()` gap) and the fake's defaults from it. The "A setting" recipe then becomes one schema
entry plus a test, and a missing piece is a compile error.

### 7.5 One way to start a long-lived process

`main/exec/spawnLoginShell.ts` holds the login shell, `-l -c 'exec "$0" "$@"'`, `childEnv`, the
process-group kill, the required `'error'` listener and a `--` before positional text. Use it from
`chat/chatManager.ts`, `claude/claudeOneShot.ts` and `pty/ptyManager.ts`. With `createExec` for
short-lived commands, that makes two sanctioned ways, both under `main/exec/`, so the
`node:child_process` allowlist is one directory. Move `credentials.ts`'s Keychain read and
`macSignature.ts` onto `createExec`.

### 7.6 UI primitives agents keep re-implementing

Each primitive below replaces copies that exist today. Add it to `ui/`, migrate the copies, then
turn on its lint rule.

| Primitive | Replaces | Lint it unlocks |
| --- | --- | --- |
| `useRovingList` (arrow, Home and End keys, typeahead) | `BranchSwitcher.tsx:56`, `NewWorktreeDialog.tsx:32`, `WorktreeConflictDialog.tsx:120` | — |
| `Menu` extended to `menuitemradio`; new `Listbox` (`aria-activedescendant`) | `chat/ModeMenu`, `chat/ModelPicker`, `chat/CommandPalette` | role restriction |
| `useOutsideDismiss` | 6 outside-click handlers (`usePopover`, `ContextMenu`, `GitMenu`, `MenuBar`, `useDialogs`, `PetChat`) | `pointerdown`/`mousedown` listener restriction |
| `useResizeDrag` moved to `ui/`, with keyboard support | `Composer`, `ImportDialog`, `TerminalListPanel`, `PaneDividers` | pointer-capture restriction |
| `ui/icons` additions | 7 new and 9 older inline SVGs | `<svg>` restriction |
| `ErrorBoundary` with `resetKey` | — | `errorBoundaries` test |

### 7.7 Types that remove casts

- Brand `ChatState.sessionId` and `SessionNode.sessionId` as `SessionId`. The 16 `asSessionId`
  call-site casts then go away, and the import restriction in §6.1 holds.
- Make `invoke` in `contract.ts` take a strict `Guard<A>` and add `invokeLoose` for the audited
  exceptions (settings, theme, log write, layout report). The loose ones are then greppable and
  covered by the `looseGuards` test.
- Type `broadcast(channel, payload)` from an `EVENTS` map in the contract, so event payloads are
  checked on the sending side as well (MAIN-11's remaining gap).
- Type `log()`'s scope parameter as `LogScope`.

## 8. Agent harness and documentation

### 8.1 Make `CLAUDE.md` a rule-to-enforcer table

The `correct` skill already says to "keep the pairing of each rule with what enforces it", but
root `CLAUDE.md` does not show the pairing. Restructure "Hard rules" and "Conventions" as:

| Rule | Enforced by | If it fires |
| --- | --- | --- |
| Persisted state goes through `JsonStore` | ESLint `no-restricted-imports` (main), `persistedStores` test | use `main/fs/jsonStore.ts` |
| ... | ... | ... |

Rules that nothing can check go in a short "Judgment calls" list below the table. Then root
`CLAUDE.md` can drop to about 150 lines (DOC-1's target; it is 246 now), because the enforced rules
explain themselves when they fire.

### 8.2 Fix the stale facts (an agent will act on each one)

| Where | Says | Fact |
| --- | --- | --- |
| `CLAUDE.md:3` | Electron 38 | Electron 44.5.1 |
| `CLAUDE.md:167` (plugin recipe) | register in `main/plugins/registry.ts` | `BUILTIN_PLUGINS` in `main/plugins/builtin.ts:11` |
| `CLAUDE.md:158` (setting recipe) | edit `AppSettings`/`DEFAULT_SETTINGS` and the fake | `AppSettings` extends the shared payload; the fake derives from `DEFAULT_SETTINGS_PAYLOAD`; the recipe omits `tests/unit/settings.test.ts`, which a new field forces |
| `CLAUDE.md:30`, `docs/architecture/session-following.md:10,26` | session following lives in `App.tsx`/`SessionColumn` | `features/workspace/useSessionFollowing.ts`, `features/pane/useShellTerminals.ts` |
| `src/renderer/state/CLAUDE.md:14` | `setLayout` | layout changes go through `workspaceReducer` |
| `docs/packaging.md:21` | dist rebuilds native modules | it does not (N-API prebuilds) |
| `CONTRIBUTING.md:60-62` | no tests in a hook | pre-push runs `test:unit` |
| `tests/CLAUDE.md` | about 180 component tests | about 330 |
| `shared/redact.ts` header | Apiary holds no credential | the Claude-usage plugin reads an OAuth token |
| `tests/integration/ipcWiring.test.ts` header | contract suite does not exist | it does (`tests/contract/`) |

Also missing:

- `APIARY_PACKAGED_APP` and the `APIARY_FAKE_*` variables in `docs/environment.md`;
- nested `CLAUDE.md` files for `src/main/chat/`, `src/main/pets/`, `src/main/statusBar/`,
  `src/renderer/features/chat/` and `src/renderer/features/pets/`;
- a `docs/architecture/chat.md` (chat crosses main and renderer, and has a protocol and a
  take-over state machine);
- ADRs for:
  - chat's `auto` default;
  - reading Claude Code's OAuth token;
  - pets' IndexedDB render cache as a second renderer persistence;
  - `--end-of-options` being removed for git < 2.44.

Each ADR should gain an **"Enforced by:"** line, the way Archgate pairs an ADR with a check (§9).

### 8.3 Claude Code hooks (`.claude/settings.json`, committed)

There is no project `.claude/settings.json` today, so an agent first learns about a lint error at
`git push`. Proposed hooks:

- **`PostToolUse` on `Edit|Write`:** run `eslint --max-warnings 0 <file>` (and `stylelint` for
  `.css`) on the edited file only, and return the output to the agent. It costs about a second per
  edit and turns every rule in §6 into in-loop feedback.
- **`Stop`:** run `npm run typecheck && npm run lint:js -- --cache` on the changed files. Block
  the stop with the errors if they fail, so "done" means the definition of done.
- **`PreToolUse` on `Bash`:** refuse `git push`, `git tag` and `gh release` with "ask the
  maintainer first". The rule is in `CLAUDE.md` and in auto-memory, but nothing enforces it.

### 8.4 Generators for the recipes

An agent copies the nearest example. Make the nearest example the canonical one by generating it:

- `npm run new -- ipc <name>`: contract entry, handler stub, fake entry and contract-suite case;
- `npm run new -- setting <key>`: schema entry and test (after §7.4);
- `npm run new -- store <name>`: an `IpcStore` and its test (after §7.1);
- `npm run new -- feature <name>`: the `features/<name>/` folder with an `index.ts`, a nested
  `CLAUDE.md` stub and an `ErrorBoundary`-wrapped root.

Each generator is a small `scripts/new.mjs` with templates. The "How to add…" recipes then say
"run the generator", and the long recipe prose can go.

### 8.5 Other agents

Add an `AGENTS.md` at the root that points to `CLAUDE.md` (one line, or a symlink). Codex, Cursor
and others read `AGENTS.md`, not `CLAUDE.md`.

## 9. Skills: what exists, what to use, what to add

**Already in this repo, and the right tools for this job:**

- [`correct`](../../.claude/skills/correct/SKILL.md) is a near-exact match for what this report
  does: it turns a repeated mistake into one the repo makes impossible, choosing architecture,
  then types, then a check, then a test, then a prose rule. It is user-invoked only
  (`disable-model-invocation: true`), so run `/correct` per drift class in §4 to implement §6
  one class at a time. Each run proves its check fails on the real past mistake.
- [`blast-radius`](../../.claude/skills/blast-radius/SKILL.md): run it on each §7 change before
  merging (`JsonStore` migration, workspace context split, `ChatService`).
- [`verify-apiary`](../../.claude/skills/verify-apiary/SKILL.md): run it for §3 items 1 and 2,
  which need the real app.

**Installed globally and useful here:** `superpowers:test-driven-development` (each §3 fix starts
with a failing test), `code-review` and `simplify` (diff-level, run before each commit), and
`superpowers:requesting-code-review`.

**Looked at externally.** None of these is worth installing; take the patterns:

- *Archgate* pairs each ADR with an executable `.rules.ts` check that fails CI. This repo already
  has `docs/adr/`. Copy the pattern: an "Enforced by:" line in every ADR, and a doc-refs check that
  the named rule or test exists.
- Factory's *"using linters to direct agents"* sets out seven lint categories for agent-written
  code: grep-ability, glob-ability, architectural boundaries, security, testability,
  observability and documentation signals. It also recommends a baseline-then-ratchet approach and
  an `AGENTS.md` mapped to rule IDs. §6 covers each category. The two this repo lacks are
  glob-ability (feature public faces, §6.2) and observability (one error policy, §6.1).
- "Architect codebase review"-style skills produce diagrams and a principles checklist (small
  modules, flat abstractions, strict typing, length limits in CI, dependency-direction tests).
  The previous review already did this more deeply for this codebase.

**Add one project skill:** `.claude/skills/architecture-drift/SKILL.md`, the method of this
report as a repeatable check. Given a base revision (the last review), it:

1. diffs to `HEAD`;
2. re-runs the §4 counts (empty catches, `fireAndForget` uses, `as` casts, brand casts, file
   sizes, the duplicate-symbol report, bridge calls outside `state/`, inline SVGs);
3. lists any rule in `CLAUDE.md` without an enforcer;
4. hands each new drift class to `/correct`.

Run it after every few feature releases. The trend table in §4 is the output format.

## 10. Roadmap

Each step is one commit with its own version bump and changelog entry (root `CLAUDE.md`). Every
guard lands as an `error` with a baseline, so the build stays green, and its commit message shows
the check failing on the real past mistake (the `correct` skill's proof rule).

### Phase 0: bugs (S each, independent)

1. `PermissionCard` focus (§3.1).
2. Native terminal paste through `terminalPaste` (SEC-6).
3. Claude-usage default and consent, plus an ADR (§3.3).
4. Chat child `'error'` listener (MAIN-19).
5. NUL byte in `registry.ts`.
6. Duplicate keyframes.
7. Sender guard denies by default.
8. `three` to `devDependencies`.
9. `usePets`/`useUpdate` ordering.
10. `PtyManager` exit identity check.
11. ErrorBoundary gaps (UI-24).

### Phase 1: cheap guards with baselines (S/M)

1. The `restrict()` helper and its config test, then the §6.1 packs that need no new code:
   - `child_process` allowlist;
   - `fs` write allowlist;
   - `ipcMain`/`webContents.send`;
   - `as unknown as` in handlers;
   - empty catch;
   - `instanceof Error` ternary;
   - storage globals;
   - `setInterval` in features;
   - inline `<svg>`;
   - test sleeps;
   - the `@shared` alias in tests;
   - `require-description`.

   Run `eslint --suppress-rule` once per rule and commit `eslint-suppressions.json`.
2. §6.4 tests that need no refactor: `contractCoverage`, `dependencyPlacement`, `noControlBytes`,
   `cssKeyframes`, `pathArgs`, `errorBoundaries`.
3. dependency-cruiser in place of madge, with the §6.2 rules and a known-violations baseline.
4. Duplicate-symbol scanner with a seeded allowlist (§6.3), plus `shared/guards.ts` and
   `shared/errors.ts` so the message has somewhere to point.
5. `.claude/settings.json` hooks (§8.3) and `AGENTS.md`.

### Phase 2: docs (S)

1. §8.2 stale facts.
2. Nested `CLAUDE.md` files for chat, pets and status bar, and `docs/architecture/chat.md`.
3. The four ADRs, each with an "Enforced by:" line.
4. The rule-to-enforcer table, shrinking root `CLAUDE.md` to about 150 lines.
5. `check-doc-refs` extended to symbols, links and ADRs.

### Phase 3: architecture (M each; run `blast-radius` and full e2e after each)

1. §7.4 `JsonStore` (port one store per commit), then single-source settings.
2. §7.5 `spawnLoginShell`, then shrink the `child_process` allowlist to `main/exec/`.
3. §7.1 `createIpcStore`, one store per commit, each deleting its `window.apiary` suppressions.
4. §7.2 workspace selectors.
5. §7.3 `ChatService` (with per-window chat attachment and pruning of exited sessions), then
   `PluginService`, then everything built in the container, then `AppService` reduced to
   delegates.
6. §7.6 UI primitives, each followed by its lint rule.
7. §7.7 type changes (branded chat ids, `invokeLoose`, typed `broadcast`, `LogScope`).

### Phase 4: CI and the loop

1. Coverage published, then thresholds set as a ratchet.
2. Nightly full e2e on Linux and macOS.
3. Packaged check of the fuses and env-hook gating.
4. `knip`.
5. The `architecture-drift` skill. Run it at the next minor release and compare its counts with
   §4. Success means every "No" row in §4 reads "Yes".

## 11. Maintainer reply (1.33.0)

All of §3, §6 and §7 were actioned on `chore/guardrails-1.33.0` in the order the maintainer set:

1. guards first (G1–G7);
2. the architecture that gives each guard one right answer (A1–A9);
3. each bug fixed test-first by its own agent, which then applied `.claude/skills/correct/SKILL.md`
   to the bug's mistake class (W1–W11).

The work-package reports are in `.agent-reports/guardrails/`, and the tracking ledger is
[2026-10-07-progress.md](2026-10-07-progress.md). Every new guard was shown to fail on the real
past mistake before it was kept.

### 11.1 Guard layer (§5, §6)

| Proposal | Outcome |
| --- | --- |
| §6.1 ESLint packs | A local plugin (`eslint/plugin.js`) reads `eslint/sanctioned.js`. It holds 30 `apiary/*` rules, each with its own allowlist of sanctioned homes and a message naming the fix. This replaces `no-restricted-*` blocks, because a later flat-config block for the same rule silently replaces the earlier one's options. `tests/unit/architecture/sanctionedRules.test.ts` proves each rule fires on its mistake and stays quiet in its home. A rule without a case fails. Also added: `require-description` and `max-lines`/`max-lines-per-function` budgets |
| Baselines | ESLint and Stylelint bulk suppressions, dependency-cruiser known violations, `.knip-baseline.json`, and every architecture test's `*.allow.json` (a reason on each entry; a stale entry fails). All are shrink-only. `npm run lint:debt` went from 837 to 311 over the release |
| §6.2 dependency-cruiser | Replaces madge: cycles, main layers (app → ipc → services → infra), renderer layers, feature public faces, orphans. Known violations went from 65 to 51 |
| §6.3 duplicate helpers | `duplicateSymbols` test (same name, same normalised body, same regex literal). Its debt entries are now 0 |
| §6.4 architecture tests | 13 tests: `sanctionedRules`, `noControlBytes`, `cssKeyframes` (also catches unknown animation names), `dependencyPlacement`, `contractCoverage` (no debt; refuses to exempt an event the fake emits), `pathArgs`, `errorBoundaries` (follows barrel re-exports), `duplicateSymbols`, `persistedStores`, `appServiceDelegates`, `looseGuards`, `perIdState`, `cacheInvalidation` |
| §6.5 Stylelint | Literal px paddings, heights and gaps fail (≥ 4 px). 275 older sites are baselined; this is deliberately left for a visual pass |
| §6.6 CI | Coverage is published every run. `lint:arch` and the knip ratchet run in the lint job. A nightly full e2e runs on Linux and macOS. Coverage thresholds act as a ratchet: each is one point under the 1.33.0 numbers (unit plus integration: 86% lines; component: 69% lines), and a drop fails the run |
| §8 harness | `.claude/settings.json` has a PostToolUse hook that lints the edited file, and Stop/SubagentStop hooks that require typecheck plus lint. Also: `AGENTS.md`; `correct` made model-invocable; a new `architecture-drift` skill; `check-doc-refs` checks paths, backticked symbols, links and ADRs; generators `npm run new -- ipc\|store\|feature\|service`. Root `CLAUDE.md` is a rule-to-enforcer table (198 lines; the ~150 target was missed because of the two tables) |

### 11.2 Architecture (§7)

| § | Outcome |
| --- | --- |
| 7.1 | `state/createIpcStore.ts` (plus a keyed variant) carries every pushed read. Commands live in `state/` with one error policy (`state/policy.ts`). Components call `window.apiary` 0 times (was 163) |
| 7.2 | The workspace sits behind a selector store. A change in one pane does not render another; a render-count test proves it. Enforced by `apiary/workspace-via-selector` |
| 7.3 | `ChatService` delivers chat state per window (`chatAttach`/`chatDetach`, `chatLifecycle` broadcast) and prunes exited chats. Also `PluginService`, and one composition root (`createContainer`/`createServices`). Module singletons are injected instances. `AppService` is a pure facade, enforced by `appServiceDelegates` |
| 7.4 | `main/fs/jsonStore.ts`: versioned, atomic, fsync, backs up a newer-version file. Settings, layout, themes and pets use it. Settings are declared once in `shared/settings/schema.ts`, and the merge is typed per field |
| 7.5 | `main/exec/spawnLoginShell.ts` requires an `error` listener and puts `--` before positional text (a type). `createExec` covers the rest. `no-raw-subprocess` has no exceptions |
| 7.6 | `ui/` primitives: `Menu` (radio), `Listbox`, `useRovingList`, `useOutsideDismiss`, `useResizeDrag` with keys, icons, and `ErrorBoundary` with `resetKey`/`compact`/`DialogBoundary` |
| 7.7 | Branded ids from the source; strict `invoke`/`send` with five audited `invokeLoose`/`sendLoose` channels; typed events (`broadcast`, `sendEvent`); `LogScope` |

### 11.3 Bugs and risks (§3), with the guard each produced

| Bug | Fix | Guard (level chosen by `correct`) |
| --- | --- | --- |
| 1 PermissionCard takes focus | Never takes focus from a text field | `apiary/focus-unless-typing` and `ui/focusUnlessTyping.ts` (9 user-opened fields baselined) |
| 2 Native terminal paste | Paste events go through `terminalPaste` | `apiary/paste-via-terminal-paste`, plus a component test |
| 3 Claude-usage token without consent | Asks once; a `Consent` type gates every read | Type plus `credentials-behind-consent` and `consent-minted-by-store`; ADR-0019 |
| 4 Chat child without `error` listener | `spawnLoginShell` requires one | Architecture (the helper's API) |
| 5 NUL byte | Escape | `noControlBytes` |
| 6 Duplicate keyframes | Renamed | `cssKeyframes`, plus the unknown-animation check |
| 7 Sender guard fails open | `senderPolicy` required; denies by default | Type plus `apiary/no-unchecked-senders-in-app` |
| 8 Stale-fetch overwrite | The store factory orders fetch against push | Architecture plus `apiary/bridge-via-state` |
| Smaller items | ChatManager pruning; per-window chat; `three`; test seams gated (`state/testSeams.ts`); `--` before prompts; realpath confinement; pet polling; `WorkingLine` live region; ImportDialog drag; PtyManager identity (one `PtyEntry`); resolver keyed by HEAD; `ps` throttled | `no-global-seams`, `confine-via-real-path`, `perIdState`, `cacheInvalidation`, `role-button-is-operable` and others; see the ledger |
| Found during the work | git ≥ 2.48 listed a bare `origin` (B20); chat end announced twice (B21); 75 behaviours where the component-test fake disagreed with main | `apiary/no-short-refnames` with `main/git/refs.ts` as the one ref reader; `ChatSession` treats `exited` as final; the fake checks the contract guards and is held to 119 contract clauses |

### 11.4 Drift classes from §4, now

Every "No" row in §4 now has an enforcer:

| Rule | Enforcer |
| --- | --- |
| fire-and-forget | `no-silent-catch`, `no-void-bridge-call`, `ignoreErrors(fn, why)` |
| atomic JSON | `no-raw-state-write`, `persistedStores` |
| exec | `no-raw-subprocess` |
| drag | `drag-via-use-resize-drag` |
| icons | `icons-from-ui` |
| menus | `roles-via-primitives` |
| shared stores | `bridge-via-state`, `no-polling-in-features` |
| AppService | `appServiceDelegates` |
| literal sizes | Stylelint, baselined |
| branded ids | `branded-ids-from-source` plus branded types |

### 11.5 Verification

On a quiet machine:

- typecheck and every linter are clean;
- unit plus integration: 1,933 passed;
- component: 524 passed;
- build ok;
- full e2e: 162 passed, 12 skipped (the opt-in live and bench specs), 0 failed;
- `npm run audit` is ok, with the 2 dated allowlisted advisories;
- coverage passes its thresholds.

`npm run test:packaged` was not run. It is opt-in, and macOS skips it unless `codesign --verify` passes. Before tagging, check that the Claude-usage consent prompt does not block it.

### 11.6 Left open

- 275 baselined literal CSS sizes (a visual change).
- 27 baselined size-budget violations (`App.tsx`, `TerminalView` and others).
- `page.waitForTimeout` in about 10 e2e sites (not covered by `no-test-sleep`).
- The search-pass half of MAIN-1.
- Root `CLAUDE.md` length.
- A keyboard shortcut to jump to a permission card announced while typing.
- SEC-5 feed signing and SEC-13 entitlements still wait for code signing.
- The hourly `CronCreate` resume job never fired in this session. Background-command sleepers
  were used to resume work after usage limits; they are recorded in the ledger.
