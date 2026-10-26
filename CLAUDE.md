# Working on Apiary

Apiary is an Electron 44 + React 19 + strict-TS desktop app for browsing, searching and resuming
Claude Code sessions across folders and git worktrees. This file is the map, the commands, the rules
with what enforces each, and the recipes. The reasons live next to the code: a nested `CLAUDE.md`
in that folder (it loads when you read a file there), or `docs/architecture/*.md` for topics that
span main and renderer. Index at the end.

## Map

- `src/main/`: the Electron main process, everything that touches the machine. `app/container.ts`
  (`createContainer`, `createServices`) builds every long-lived object; `appService.ts` is a facade.
- `src/renderer/`: React, no Node. Stores and commands in `state/` are the only code that touches
  `window.apiary`; stores are built with `createIpcStore`.
- `src/shared/`: types, guards and pure helpers for both sides. `shared/ipc/contract.ts` declares
  every channel; `ApiaryApi`, the preload bridge and main's handler types derive from it.
- Tests: `tests/unit`, `tests/integration`, `tests/component` (Chromium, `fakeApiary.ts`),
  `tests/contract` (one spec run on the fake and on real main), `tests/e2e`. See [`tests/CLAUDE.md`](tests/CLAUDE.md).

| Area | Main | Shared | Renderer | Tests |
| --- | --- | --- | --- | --- |
| IPC | `main/ipc/registrar.ts`, `main/ipc/handlers/` | `shared/ipc/` | `preload/index.ts` (generated), commands in `state/` | `unit/ipc*`, `contract/bridgeContract.ts` (clauses in `contract/clauses/`) |
| Sessions, scan, store | `main/sources/`, `main/scanner/`, `main/sessions/`, `main/store/` ([CLAUDE.md](src/main/store/CLAUDE.md)) | `shared/domain/session.ts` | `state/treeStore.ts` | `integration/sessionStore.test.ts`, `e2e/sidebar*.spec.ts` |
| Terminals, ptys | `main/pty/` ([CLAUDE.md](src/main/pty/CLAUDE.md)), `main/terminals/` | `shared/domain/pty.ts` | `features/terminal/`, `state/ptyBus.ts` | `unit/screenSnapshot*`, `e2e/terminal*.spec.ts` |
| Windows, tabs, layouts, following | `main/windows/` | `shared/domain/tabs.ts`, `shared/activity.ts` | `features/workspace/` (store, reducer, `useSessionFollowing.ts`), `features/pane/useShellTerminals.ts`, `state/layout.ts` | `unit/workspace*`, `e2e/{multiWindow,detachTab,sessionFollowing}.spec.ts`; docs: [windows-and-tabs](docs/architecture/windows-and-tabs.md), [activity](docs/architecture/activity.md), [session-following](docs/architecture/session-following.md) |
| Search | `main/search/` ([CLAUDE.md](src/main/search/CLAUDE.md)) | `shared/treeFilter.ts` | `state/useSessionTreeCache.ts` | `unit/searchLoad.test.ts`, `e2e/search.spec.ts` |
| Chat mode | `main/chat/` ([CLAUDE.md](src/main/chat/CLAUDE.md)) | `shared/domain/chat.ts`, `shared/chatTimeline.ts` | `features/chat/` ([CLAUDE.md](src/renderer/features/chat/CLAUDE.md)), `state/chatStore.ts` | `unit/chat*`, `e2e/transcriptChat.spec.ts`; doc: [chat](docs/architecture/chat.md) |
| Claude accounts | `main/accounts/` ([CLAUDE.md](src/main/accounts/CLAUDE.md)) | `shared/domain/accounts.ts` | `state/accountsStore.ts`, `state/accountSwitch.ts`, `features/settings/sections/AccountsSection.tsx` | `unit/accounts/`, `integration/accountLaunch.test.ts`, `e2e/accounts.spec.ts`; [ADR-0020](docs/adr/0020-per-session-accounts-are-linked-config-folders.md) |
| Pets | `main/pets/` ([CLAUDE.md](src/main/pets/CLAUDE.md)) | `shared/pets/` ([CLAUDE.md](src/shared/pets/CLAUDE.md)) | `features/pets/` ([CLAUDE.md](src/renderer/features/pets/CLAUDE.md)), `state/petsStore.ts` | `unit/pet*`, `e2e/pets.spec.ts` |
| Themes | `main/theme/` | `shared/theme/` ([CLAUDE.md](src/shared/theme/CLAUDE.md)) | `theme/`, `state/themeStore.ts` | `unit/theme*`, `e2e/themes.spec.ts` |
| Settings | `main/settings.ts`, `main/settings/settingsService.ts` ([CLAUDE.md](src/main/CLAUDE.md)) | `shared/settings/schema.ts` | `features/settings/`, `state/settingsStore.ts` | `unit/settings*`, `e2e/settings.spec.ts` |
| Plugins, status bar | `main/plugins/` ([CLAUDE.md](src/main/plugins/CLAUDE.md)), `main/statusBar/` ([CLAUDE.md](src/main/statusBar/CLAUDE.md)) | `shared/domain/plugins.ts`, `shared/domain/statusBar.ts` | `features/statusBar/`, `state/statusBarStore.ts` | `integration/pluginBar.test.ts`, `unit/statusBarRegistry.test.ts` |
| Updater, log, git | `main/update/` ([CLAUDE.md](src/main/update/CLAUDE.md)), `main/log/` ([CLAUDE.md](src/main/log/CLAUDE.md)), `main/git/` | `shared/domain/update.ts`, `shared/redact.ts`, `shared/domain/git.ts` | `features/update/`, `features/git/`, `state/updateStore.ts` | `unit/updateService*`, `integration/branchOps.test.ts` |
| Processes, JSON files | `main/exec/`, `main/fs/jsonStore.ts` ([CLAUDE.md](src/main/CLAUDE.md)) | none | none | `unit/spawnLoginShell.test.ts`, `unit/jsonStore.test.ts` |

## Commands

| Task | Command |
| --- | --- |
| Run / build | `npm start` / `npm run build` |
| Typecheck (both tsconfigs) | `npm run typecheck` |
| Lint everything (incl. layer rules, dead code and the architecture tests) / autofix | `npm run lint` / `npm run lint:fix` |
| Unit + integration | `npm test` (`npm run test:unit`, `npm run test:integration`) |
| Component (Chromium) | `npm run test:component` |
| UI audit and screenshots (`ui-review/index.html`) | `npm run ui:review` |
| E2E (builds first) / smoke (what CI runs) | `npm run test:e2e` / `npm run test:e2e:smoke` |
| Generate a stub | `npm run new -- <ipc\|store\|feature\|service> <name>` |
| Debt totals | `npm run lint:debt` |

One test per layer (why e2e needs `--no-deps`: [`tests/CLAUDE.md`](tests/CLAUDE.md)):

```sh
npm test -- tests/unit/x.test.ts
npm run test:integration -- tests/integration/x.test.ts
npm run test:component -- tests/component/x.test.tsx
npm run build && npx playwright test tests/e2e/x.spec.ts --project=parallel --no-deps
```

No command rebuilds a native module ([`docs/testing.md`](docs/testing.md)), so any order works after `npm ci`.

## Never

- Push, tag or release without asking the maintainer.
- Add AI attribution to a commit or PR; `.husky/commit-msg` rejects it.
- Let the renderer supply a filesystem path that main acts on.
- Grow a baseline or an allowlist to make a check pass (see "Guard layer").

## Definition of done

- `npm run typecheck && npm run lint` pass.
- A test in the cheapest layer that proves the change fails without it and passes with it: `npm test`
  for main/shared, `npm run test:component` for the renderer, an e2e spec only for real wiring.
- A change a person sees has its states in a UI scenario that passes the UI audit, and its
  screenshots have been looked at (`.claude/skills/ui-review/SKILL.md`).
- Version bumped and a new `CHANGELOG.md` section added, in a Conventional Commit.

## Versioning, changelog, commits

- **Every change bumps the version and adds its own `CHANGELOG.md` section.** Never reuse a version
  or batch changes: every commit's version is published. Patch or minor per SemVer; the maintainer
  decides major. Bump with `npm version <x.y.z> --no-git-tag-version` (it updates `package.json` and
  `package-lock.json`); `tests/unit/architecture/versionConsistency.test.ts` fails if they or the newest changelog heading disagree.
- Subject: `type(scope): X.Y.Z — summary`, at most 150 characters (`commitlint.config.js`).
- `CHANGELOG.md` is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) (`### Added`, `### Changed`,
  `### Fixed`, `### Security`); a version that did not ship everywhere is annotated on its heading.
- A `v*` tag starts `.github/workflows/release.yml`. Dependabot PRs get their bump from CI
  (`scripts/dependabot-bump.mjs`); do not hand-bump them. `npm run audit` gates CI and the release,
  and runs daily on main (`.github/workflows/audit.yml`), keeping one open `security-audit` issue
  while it fails.

## Rules and what enforces them

When a check fires, its message names the replacement. The `apiary/*` rules are in
`eslint/sanctioned.js` (named here without the prefix); each allows only its sanctioned homes.

| Rule | Enforced by | If it fires |
| --- | --- | --- |
| Processes start only in `main/exec` | `no-raw-subprocess` | `createExec` (short-lived) or `spawnLoginShell` (long-lived claude/shell) |
| Every `claude` Apiary starts runs under its session's account (`CLAUDE_CONFIG_DIR` for an added one, nothing for main) | `tests/unit/architecture/claudeStartsWithAccount.test.ts` | `AccountService.launchEnv(account)`, passed as the pty `env` or `spawnLoginShell`'s `extraEnv` |
| User text reaches a spawned `claude` after `--` | types: `LoginShellCommand` is `{ bin, flags, positional }` and `loginShellInvocation` inserts the `--`; `tests/unit/loginShell.test.ts` | pass the text as `positional`, fixed options as `flags` |
| A path is confined to a directory by real path | `confine-via-real-path`; `tests/unit/confine.test.ts` | `realPathInside` in `main/fs/confine.ts` |
| Ref names come from git as full refnames; the short form (`%(refname:short)`, `--abbrev-ref`, `symbolic-ref --short`) is never parsed | `no-short-refnames`; `tests/integration/branchOps.test.ts` (a clone with its remote HEAD set) | `listRefsArgs`, `parseRefRows`, `branchFromRef` in `main/git/refs.ts` |
| Persisted state is written only through `main/fs`; every userData JSON file is a `JsonStore` | `no-raw-state-write`; `tests/unit/architecture/persistedStores.test.ts` | `JsonStore` in `main/fs/jsonStore.ts`; `moveFile` (`main/fs`) for a file that is not app state; list a new file in the test |
| A remote window's call never acts on the work machine's screen: a handler using `shell`, `dialog`, `clipboard` or `BrowserWindow` is not `remote` | `tests/unit/architecture/remoteScopes.test.ts` | scope it `local`, `bridged` or `unavailable` in `main/remote/scopes.ts` |
| IPC goes through the contract and registrar | `ipc-through-registrar`; types (a channel with no handler or fake does not compile) | `npm run new -- ipc <name>` |
| The IPC sender check fails closed (a missing sender frame is rejected); only test harnesses opt out | `IpcDeps.senderPolicy` is required (type); `no-unchecked-senders-in-app`; `tests/unit/ipcRegistrar.test.ts` | pass the `TrustedRendererConfig`; `UNCHECKED_SENDERS` is for tests |
| Main to renderer events use `broadcast` / `sendEvent` | `send-through-windows`; `EventSpec` types | `main/windows/` helpers |
| Everything handed to the IPC registrar is required (`X \| null` where it does not exist), so `index.ts` cannot leave one out | `tests/unit/architecture/ipcDepsRequired.test.ts`; types | add the member as `name: T \| null` and pass it in `index.ts` and the test harnesses |
| Long-lived objects are built in the container; `AppService` stays a facade | `construct-in-container`; `appServiceDelegates` test | `main/app/container.ts` (remote access: `main/app/remoteContainer.ts`); put logic in the owning service |
| Layers point down (main: app, ipc, services, infra; renderer: features, then state and ui) | dependency-cruiser `main-infra-stays-down`, `main-services-below-ipc`, `main-ipc-below-app`, `renderer-ui-and-state-below-features`, `renderer-features-below-app` | inject the dependency, or move the shared piece down a layer |
| A handler validates and delegates; no fs, process or store | dependency-cruiser `ipc-handlers-are-adapters` | move the work into a service in `main/<domain>/` |
| A feature is imported only through its `index.ts`; no cycles; no orphan files | dependency-cruiser `renderer-feature-public-face`, `no-circular`, `no-orphans` | export from `index.ts`, lift the shared piece, or delete the file |
| One import line per module (a separate `import type` line is fine) | ESLint `no-duplicate-imports` | merge them into one statement |
| Imports respect the process: no `electron`/`node:*` in renderer or shared, no renderer in main | ESLint `no-restricted-imports`; `tsc` | `window.apiary`, or move the helper to `src/shared/` |
| Components never touch `window.apiary` | `bridge-via-state`; `no-void-bridge-call` | a store or command in `src/renderer/state/` |
| Shared renderer state comes from a store factory, never a hand-rolled listener set | `stores-via-factory` | `createIpcStore` (main owns it), `createLocalStore` (in memory, per window), `state/uiState.ts` (saved); `state/CLAUDE.md` "Which store" |
| A test seam is a field of `state/testSeams.ts`, never a `globalThis.__apiary*` global; inert when packaged | `no-global-seams`; `env.ts` `APIARY_RENDERER_SEAMS` | `TestSeams` + `testSeams()`; `setTestSeams` in a test |
| No `setInterval` in components | `no-polling-in-features` | a push event, or one shared timer in `state/` |
| A pane reads its own workspace slice | `workspace-via-selector` | `useWorkspaceSelector`, `usePaneWorkspace` |
| Text pasted into a terminal goes through `pasteText`, which strips ESC (SEC-6) | `paste-via-terminal-paste`; `tests/component/terminalNativePaste.test.tsx` | `pasteText` / `routeNativePaste` in `features/terminal/terminalPaste.ts` |
| Renderer storage goes through `state/uiState.ts` | `no-raw-storage` | `uiState.ts` |
| A `role="button"` on a non-button is focusable and key-operable | `role-button-is-operable` | a real `<button>`, or `tabIndex={0}` plus `onKeyDown` for Enter and Space |
| Icons, widget roles, drags, outside-click close come from `ui/` | `icons-from-ui`, `roles-via-primitives`, `drag-via-use-resize-drag`, `outside-dismiss-via-ui` | the primitive in `src/renderer/ui/` |
| Something that appears on its own never takes focus from a text field; a field the person asked for takes it with one helper, never `autoFocus`, and opens with its text selected | `focus-unless-typing`; `transcriptChat` and `focusAskedFor` component tests | `focusUnlessTyping` / `ref={focusAskedFor}` in `ui/focusUnlessTyping.ts` |
| Branded ids are minted where data enters | `branded-ids-from-source`; types | carry the id; brand the field in its shared type |
| No swallowed errors; one error-to-text helper; no `as unknown as` | `no-silent-catch`, `error-message-helper`, `no-cast-through-unknown` | `background`/`surface` (renderer), `fireAndForget`, `ignoreErrors` (expected and harmless: say why), `errorMessage`, a type guard from `@shared/guards` |
| Every IPC guard proves its declared types | `invoke`/`send` types; `looseGuards` test | `invokeLoose` plus a named validator and an allowlist entry |
| A path argument crossing IPC has a main-side validator | `pathArgs` test | validate in the service; record it in the allowlist |
| Every channel has a contract clause, or a reasoned exemption (never debt); an event the fake emits is never exempt | `contractCoverage` test | add the clause under `tests/contract/clauses/`; it runs on the fake and on real main |
| A component test's `fake.emit` sends the event's real payload (a chat update is a `ChatPush`, a pty id a `PtyId`) | types: `emit<K>(event: K, ...args: PayloadOf<K>)` in `tests/component/fake/state.ts` | build the payload the contract declares; `chatPush` for a chat state |
| The fake `window.apiary` refuses what main refuses, and hands out copies | the fake runs each call through the contract's own guard and `structuredClone`s what crosses; `contract/clauses/misc.ts` | change `tests/component/fake/<area>.ts` and its clause together |
| Per-id state is one record, not parallel maps; a callback checks its object is still the id's occupant | `perIdState` test | one record type and one `Map<string, Record>`, as `PtyEntry` in `main/pty/ptyManager.ts` |
| A cache says what invalidates it, and its entries carry that key; per-event work is throttled | `tests/unit/architecture/cacheInvalidation.test.ts` | a doc comment "Invalidated by …" on the field; a stamp on the entry (see `WorktreeResolver`) |
| One definition per helper, constant and regex | `duplicateSymbols` test (same name, same body, same regex literal) | import the first definition (`@shared/guards`, `@shared/errors`, `@shared/text`, `@shared/domain/ids`); the failure names the home |
| Mounted components cannot blank the window | `errorBoundaries` test (App's layout and `DialogHost`); `regionBoundaries` component test | wrap where it is rendered: `ErrorBoundary compact` (a bar), `fallback={null}` (a decorative layer), `DialogBoundary` (a dialog) |
| Claude Code's token is read, and sent to Anthropic, only after the user agreed | `Consent` type (`readAccessToken`, `fetchLimits`); `credentials-behind-consent`, `consent-minted-by-store`; `claudeUsageConsent.test` | `ConsentStore.proof()` in `statusBar/claudeUsage/consent.ts`; [ADR-0019](docs/adr/0019-claude-usage-asks-before-reading-the-token.md) |
| Settings are declared once | `SETTINGS` schema; `settingsSchema` test; the renderer mirror (`state/settingsStore.ts`) is derived from it | one entry in `shared/settings/schema.ts`, plus its control |
| The version is the same in `package.json`, `package-lock.json` and the newest changelog heading | `tests/unit/architecture/versionConsistency.test.ts` | `npm version <x.y.z> --no-git-tag-version`, then a new changelog section |
| What a tab shows is `TabView`, never a retyped `'transcript' \| 'terminal'` | `tab-view-type` | `TabView` from `@shared/domain/tabs` |
| Log scopes are known | `LogScope` type | add the scope in `shared/domain/log.ts` |
| A source comment carries a fact that still holds, never history (an Apiary version, a review id); narration and apologies go, the code that needed them is renamed or reshaped | `tests/unit/architecture/commentHistory.test.ts`; the `trim-comments` skill on every agent branch before it merges (`agent-orchestration` review step) | keep the fact, drop the history; `CHANGELOG.md` and git hold the rest |
| Renderer-only packages are `devDependencies`; one `@keyframes` name; no raw control bytes | `dependencyPlacement`, `cssKeyframes`, `noControlBytes` tests | move the package; rename the animation; write `\u001b` |
| What a person sees is not broken: no clipped labels, cut-off controls, overlaps, controls side by side off each other's centre line, see-through popups, browser-default controls, bullets in chrome; every class used is styled | UI audit (`tests/component/ui/audit.ts`) in every UI scenario; `classesDefined` test; Stop hook (a renderer change needs a scenario) | a scenario in `tests/component/ui/` with `reviewUi`; `npm run ui:review`; `.claude/skills/ui-review/SKILL.md` |
| An animation that never ends has a still counterpart: no continuous motion when Apiary draws without the GPU (`<html data-motion>`, `src/renderer/state/motion.ts`) | `tests/unit/architecture/reducedMotionCss.test.ts` | a `:root[data-motion="reduced"] <selector> { animation: none; … }` rule beside the animation, keeping a still cue; never a `prefers-reduced-motion` copy |
| Each `apiary/*` rule still fires | `tests/unit/architecture/sanctionedRules.test.ts` | add a case for a new rule |
| A CSS variable a stylesheet uses is defined (by a stylesheet, a theme or code) | `tests/unit/architecture/cssVarsDefined.test.ts` | a token from `styles/00-tokens.css` (`--muted`, `--text`, …) |
| Colour, radius, height, padding, gap come from tokens | stylelint `declaration-property-value-disallowed-list` | spacing `--space-*`, icons `--icon-size-*` / `--icon-button-size-*` / `--dot-size-*`, `--radius-*`, `--control-*`, the `.btn` layer (`styles/00-tokens.css`, [`src/renderer/CLAUDE.md`](src/renderer/CLAUDE.md)) |
| File and function size (400 / 120 lines) | ESLint `max-lines`, `max-lines-per-function` | split by responsibility |
| Tests wait on conditions and import `@shared/` | `no-test-sleep`, `shared-alias-in-tests` | `vi.waitFor`, `expect.poll`, `stays` for "nothing happens"; the alias |
| No dead code; docs name real paths, symbols and links; a disable comment says why and is needed | knip ratchet (`npm run lint:dead`); `scripts/check-doc-refs.mjs` (`npm run lint:md`); ESLint `reportUnusedDisableDirectives`, stylelint `reportNeedlessDisables` | delete it; fix the doc; add `-- <reason>`; drop a disable nothing needs |
| Lint on each edit; no stop with a red typecheck or lint; the Stop hook runs every step of `npm run lint` | `.claude/hooks/lint-edited.mjs`, `.claude/hooks/definition-of-done.mjs`, `tests/unit/architecture/stopHookCoversLint.test.ts` | fix what it prints; a new lint step gets its counterpart in the hook |
| A behaviour change has a test that fails without it: the branch's changed unit, integration and component tests run against the base's `src/`, and at least one must fail | `.claude/hooks/testsFailOnBase.mjs` (Stop hook) | write the test from the requirement, see it fail on the old code, then fix; a pure refactor says why in `No-Red-Test-Reason:` |
| A commit is made on a branch, never on a detached HEAD (rebase and cherry-pick excepted); look at an old file with `git show <rev>:<path>` | `.husky/pre-commit` | `git switch <branch>` or `git switch -c <name>` |
| Agent worktrees run the git hooks too (husky's hook folder is generated, not committed) | `scripts/agents/run-agent.sh` installs it before an agent starts | run `npx husky` in a worktree made by hand |
| Commit hygiene | `.husky/pre-commit` (lint-staged), `.husky/commit-msg` (commitlint, no AI attribution), `.husky/pre-push` (typecheck, lint, `test:unit`) | fix, never `--no-verify` |
| A release passes the whole e2e suite, `@serial` included, not only the specs a change seemed to touch | `.husky/pre-push`: pushing a `v*` tag runs `npm run test:e2e` and refuses the push if it fails | fix the spec or the code, then push the tag again |
| A release tag goes only on a commit CI has passed (the release repeats CI's checks on Linux; five tags stopped there and published nothing) | `.husky/pre-push` runs `scripts/release-ci-gate.mjs` for a `v*` tag; `tests/unit/releaseCiGate.test.ts` | push `main`, wait for CI on it (`gh run watch`), then push the tag; a failed CI means a fix and a new version |

## Judgment calls

Nothing fails when these are broken; the reason is in the linked doc.

- The renderer never supplies a path that main acts on; main resolves it from an id it trusts
  ([boundaries](docs/architecture/boundaries.md), [ADR-0001](docs/adr/0001-renderer-never-supplies-a-path.md)).
- A working directory comes from the session JSONL `cwd`, never the directory name.
- Git's prose is not an interface: use `--porcelain` and `--`, never parse errors.
- A pty belongs to main, never spawn over a live id, a late view gets a rendered snapshot
  ([windows-and-tabs](docs/architecture/windows-and-tabs.md)). Activity reads the rendered screen
  ([activity](docs/architecture/activity.md)).
- A rescan never writes `cwd_override` or `project_path` ([`src/main/store/CLAUDE.md`](src/main/store/CLAUDE.md)).
- Layout changes go through `tidyLayout` ([`src/renderer/state/CLAUDE.md`](src/renderer/state/CLAUDE.md)).
- A pet and a theme are data; `validatePet` and `validateTheme` are the only way in; no
  `backdrop-filter` ([`src/shared/pets/CLAUDE.md`](src/shared/pets/CLAUDE.md), [`src/shared/theme/CLAUDE.md`](src/shared/theme/CLAUDE.md)).
- A missing setting over IPC means unchanged; changing a default needs `SETTINGS_VERSION` and a
  migration ([`src/main/CLAUDE.md`](src/main/CLAUDE.md)).
- The diagnostic log never gets conversation content ([`src/main/log/CLAUDE.md`](src/main/log/CLAUDE.md)).
- A release ships `latest-*.yml` and keeps the macOS `zip` target ([`src/main/update/CLAUDE.md`](src/main/update/CLAUDE.md)).
- Comments say why, not what. Tests are statements about behaviour. A helper both sides need lives
  in `src/shared/`. Measure before fixing ([`docs/debugging.md`](docs/debugging.md)).

## Guard layer

The lint baselines (`eslint-suppressions.json`, `stylelint-suppressions.json`,
`.dependency-cruiser-known-violations.json`, `.knip-baseline.json`) are **empty, and
`tests/unit/architecture/baselinesEmpty.test.ts` keeps them empty**. 1.34.0 grandfathered 450-odd
violations into them as "shrink-only", and three releases later not one had been fixed; the 1.38
cleanup fixed them all. The `tests/unit/architecture/*.allow.json` allowlists hold reasoned exceptions, never
debt, and only shrink.

- A new violation is a bug to fix, not an entry to add. Never `--suppress`, never run a `:baseline`
  script to hide one, never add to an allowlist by hand.
- The maintainer adopting a new rule that existing code breaks either fixes the sites in the same
  change, or baselines them by changing `tests/unit/architecture/baselinesEmpty.test.ts` on purpose, with the plan to empty it.
- A disable comment says why and must be needed (ESLint `reportUnusedDisableDirectives`, stylelint
  `reportNeedlessDisables`); `lintDisables.allow.json` counts them per file.
- Why: [ADR-0011](docs/adr/0011-sanctioned-ways-with-shrink-only-baselines.md).
- A new rule is an entry in `eslint/sanctioned.js` (files, allow, a message naming the replacement)
  and a case in `tests/unit/architecture/sanctionedRules.test.ts`. Apply `.claude/skills/correct/SKILL.md`.

## How to add…

Generators write stubs that fail until finished, never ones that are green and wrong.

- **An IPC call.** `npm run new -- ipc <name>` adds the contract entry, handler, fake and contract
  clause stubs. Then fill each: guard and result in `shared/ipc/contract.ts`, the handler (validate,
  delegate to a service), the fake (mirror every event main emits), the clause in
  `tests/contract/clauses/<area>.ts`, and a command in `state/`.
- **A store.** `npm run new -- store <name> --fetch <call> [--event <onCall>]`: `state/<name>Store.ts`
  on `createIpcStore`, and a test stub. Commands follow one policy from `state/policy.ts`.
- **A feature.** `npm run new -- feature <name>`: `features/<name>/` with `index.ts`, an
  `ErrorBoundary`-wrapped root, a `CLAUDE.md` stub and a component test stub.
- **A main service.** `npm run new -- service <name>`: `main/<name>/<name>Service.ts` with injected
  deps. Build it in `createContainer`; add its class to `construct-in-container`.
- **A setting.** One entry in `SETTINGS` (`shared/settings/schema.ts`): guard, default, range. The
  type, defaults, merge and fake derive from it. Add the control in `features/settings/`. Changing
  an existing default also needs a migration ([`src/main/CLAUDE.md`](src/main/CLAUDE.md)).
- **A mirrored (library) preference.** Something that describes the sessions (how they are arranged
  or read) rather than the screen: one entry in `LIBRARY_STATE` (`shared/libraryState.ts`), read with
  `useLibraryState`, written with `updateLibraryState`. A remote window then shows the work
  machine's. Never a `uiState` field ([library-state](docs/architecture/library-state.md)).
- **A working animation, or a colour for one.** An id and its entry in
  `src/shared/domain/busyAnimation.ts` (label, description, the colours it offers), its view in
  `src/renderer/ui/BusyGlyph.tsx`, and its CSS in `src/renderer/styles/35-busy.css` with a
  `:root[data-motion="reduced"]` still frame; the orbit engine there draws any dots-on-a-circle
  variation from per-dot variables. The `Record`s make a missing piece a compile error;
  `tests/component/busyAnimation.test.tsx` and `tests/component/motion.test.tsx` cover every id.
- **A session-bar plugin.** A factory in `BUILTIN_PLUGINS` (`main/plugins/builtin.ts`); pass it what
  it needs in `PluginService`. See [`src/main/plugins/CLAUDE.md`](src/main/plugins/CLAUDE.md).
- **A status-bar item, a theme token or effect, a log line.** [`src/main/statusBar/CLAUDE.md`](src/main/statusBar/CLAUDE.md),
  [`src/shared/theme/CLAUDE.md`](src/shared/theme/CLAUDE.md), [`src/main/log/CLAUDE.md`](src/main/log/CLAUDE.md).
- **A test.** Component tests drive the renderer against `fakeApiary.ts`; update the fake first. e2e
  specs use `launchApiary` and `Harness` from `tests/e2e/helpers.ts`; tag `@serial` for the
  clipboard, focus or timing, and `@smoke` only for a main path. [`tests/CLAUDE.md`](tests/CLAUDE.md).

## Where the rest lives

- Nested `CLAUDE.md`: `src/main/` (with `chat/`, `pets/`, `statusBar/`, `pty/`, `search/`, `store/`,
  `update/`, `plugins/`, `log/`), `src/renderer/` (with `state/`, `features/chat/`,
  `features/pets/`), `src/shared/theme/`, `src/shared/pets/`, `tests/`.
- [`docs/architecture/`](docs/architecture/README.md): topics spanning main and renderer.
- [`docs/environment.md`](docs/environment.md): every `APIARY_*` variable (parsed once in
  `src/main/app/env.ts`, `undefined` when packaged) and every userData file.
- [`docs/testing.md`](docs/testing.md), [`docs/debugging.md`](docs/debugging.md),
  [`docs/packaging.md`](docs/packaging.md).
- [`docs/adr/`](docs/adr/README.md): decisions with a rejected alternative, each naming its check.
- `docs/history/`, `docs/superpowers/`, `docs/reviews/`: history. The code wins where they differ.
- `.claude/skills/`: `verify-apiary` (and `maintain-verify-apiary`, the audit that keeps its feature map true), `blast-radius`, `correct`, `trim-comments`, `architecture-drift`, `ui-review`
  (designing UI, the UI audit and the screenshot review), and
  `agent-orchestration` (running Haiku, Sonnet or Opus agents in worktrees with `scripts/agents/run-agent.sh`).
- [`CONTRIBUTING.md`](CONTRIBUTING.md): the human onboarding path and the linter breakdown.
