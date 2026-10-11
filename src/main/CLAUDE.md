# src/main — the Electron main process

Read with root CLAUDE.md; this covers settings storage and IPC, and points at the deeper homes for
each subsystem. Subfolders with their own `CLAUDE.md`: [`chat/`](chat/CLAUDE.md),
[`pets/`](pets/CLAUDE.md), [`pty/`](pty/CLAUDE.md), [`search/`](search/CLAUDE.md),
[`statusBar/`](statusBar/CLAUDE.md), [`store/`](store/CLAUDE.md), [`update/`](update/CLAUDE.md),
[`plugins/`](plugins/CLAUDE.md), [`log/`](log/CLAUDE.md). Windows and tabs
(`windows/`) live in [docs/architecture/windows-and-tabs.md](../../docs/architecture/windows-and-tabs.md)
because that topic spans main and renderer.

`src/main/ipc/registrar.ts` wires every handler in `ipc/handlers/*.ts` against
`shared/ipc/contract.ts`; see root CLAUDE.md's "How to add… an IPC call" recipe before adding one.

## Starting processes (`exec/`)

Only `src/main/exec/` imports `node:child_process` (the `no-raw-subprocess` lint rule, no exceptions).
There are two ways to start a process. `createExec` (`run.ts`; `createExecWithStderr` when the
report is on stderr) is for a short-lived command whose stdout you want: timeout, buffer cap,
logging, `execFile` only. `spawnLoginShell` (`spawnLoginShell.ts`) is for a long-lived `claude`
through the user's login shell (chat, one-shot): it owns the argv and env (`loginShell.ts`, shared
with the node-pty spawn), process-group kill and `stop()`, and its `exited` promise always settles,
including when the spawn itself fails, so await that rather than listening to the child's events.
A program that must outlive Apiary (VS Code) goes through `launchDetached`.

## Settings

Each setting is declared once, in `SETTINGS` (`shared/settings/schema.ts`): key, guard, default and
range. `AppSettingsPayload` and `DEFAULT_SETTINGS_PAYLOAD` are derived from it. `main/settings.ts`
adds the main-only fields to make `AppSettings` and `DEFAULT_SETTINGS`, and holds `SETTINGS_VERSION`,
`migrateSettings` and `mergeSettingsPayload` (which runs `mergePayload` over the schema);
`settings/settingsService.ts` owns the loaded instance; `ipc/handlers/settings.ts` is the
`settingsGet`/`settingsSet` IPC surface (`settingsGet` is `pickPayload` plus the plugin fields).

**Changing a default reaches nobody.** `saveSettings` writes the **whole** settings object
(atomically — tmp file then rename, so a crash mid-write cannot corrupt it), and the app writes it
whenever the first window is moved or resized. So every `settings.json` in existence already pins
every field to whatever the default was on the day it was first written, and **changing
a default in the schema only ever affects someone who has never run the app**. This was found the slow
way: the prompt trim was "defaulted on" in 1.13.2 and nothing changed for anyone.

Changing a default for existing users means a migration: bump `SETTINGS_VERSION`, extend
`migrateSettings`, and only touch values that are still exactly what the old default was — someone
who chose a value has said what they want. The migrated result is written back at startup, or it
would be re-applied on every launch and undo a later deliberate change.

**Settings arriving over IPC: a missing field means "unchanged", never `false`.**
`AppSettingsPayload` is typed, but it crosses a process boundary from a renderer that is not
guaranteed to be the same build as the main process — a dev reload, or an update that reloads the
window. A key the sender has never heard of is simply absent, so `mergeSettingsPayload` treats a
missing field as "unchanged" rather than as `false`. A present value that fails its guard (a string
for a boolean, a non-boolean in `plugins`) is dropped the same way and logged by key; an out-of-range
number is clamped. Getting it wrong once cost a whole afternoon,
because the failure hides itself — the feature switched off in memory, its index was wiped as a
switch-off is meant to do, and `JSON.stringify` dropped the undefined key so the file on disk still
said the feature was on.

## Persisted state: `JsonStore`

Every JSON file Apiary reads back on its own (`settings.json`, `session-layout.json`,
`themes.json`, `pets.json`) is opened through `fs/jsonStore.ts`'s `JsonStore`: a `version` that is
written and read back and handed to `parse` for migration, an atomic write that fsyncs the temp
file, and a `fallback` for a missing or corrupt file. A file from a *newer* Apiary is copied to
`<file>.v<N>.bak` before the first write replaces it. The lint rule no-raw-state-write allows raw writes
only under `src/main/fs`, and `tests/unit/architecture/persistedStores.test.ts` lists each file's
owner — a new userData file needs an entry there. See
[ADR-0012](../../docs/adr/0012-one-versioned-json-store.md).

## Composition and the session services

A new long-lived service: `npm run new -- service <name>`, then build it in `createContainer`, add
its class to the `construct-in-container` list in `eslint/sanctioned.js`, and hand it to the
handlers that need it. A new IPC call: `npm run new -- ipc <name>`.

`app/container.ts` is the one place long-lived main-process objects are constructed, with
`app/remoteContainer.ts` holding remote access's part of it (the construct-in-container lint rule
allows those two; the one other exception is the search worker's own `SearchIndex`, on its own
thread). `createContainer(env, paths, inputs)` builds the windows, settings, updater,
themes, pets and the watcher, and calls `createServices(options)` for the session side, so a test
builds the same graph around a temp directory (`tests/fixtures/buildService.ts`). Construction is
pure — no window, timer, poll or refresh; `index.ts` resolves what needs Electron and starts things
in order (the `SessionWatcher`, the status bar, the updater).

Who builds what, and who owns the behaviour:

- **Instances, not module state.** `WorktreeResolver` (project-resolution cache and `git` spawn
  count), `BranchOps` (the `git` runner and its spawn count), `MrStatusCache` (merge-request
  answers, in-flight lookups, "`glab` is missing") and `TranscriptReader` (the line-offset index)
  each take their `exec` and are built once; a test builds its own, so there is no
  module-level cache or test hook to reset. One `ClaudeProjectsSource` is shared by the
  catalog, the actions and the watcher.
- **A cache states its invalidation.** `WorktreeResolver` keeps each folder's answer with the
  stamp of its `HEAD` file and re-resolves when the stamp moves, so a `git checkout` outside Apiary
  shows on the next scoped pass. A new cache says what invalidates it in a doc comment and its
  entries carry that key. Per-event work is throttled the same way: scoped passes scan `ps` at
  most every few seconds, with one trailing scan (`SessionCatalog.scanLive`).
- **Services own behaviour.** `sessions/sessionResolver.ts` (trust boundary),
  `sessions/sessionCatalog.ts` (refresh loop and the `live` map), `sessions/sessionActions.ts`
  (rename/note/remove/move), `sessions/transcriptService.ts` (transcript pages, the pets' latest
  actions), `git/gitService.ts`, `search/searchService.ts`, `terminals/terminalService.ts`,
  `media/imageStore.ts`, `vscode/vscodeService.ts`, `chat/chatService.ts` and
  `plugins/pluginService.ts`.
- **`AppService` is a facade** over those: every method is one delegating statement, enforced by
  `tests/unit/architecture/appServiceDelegates.test.ts` (its allowlist holds only `dispose`, the
  shutdown ordering). Chat and plugins are not fronted by it — their handlers take `ChatService`
  and `PluginService` directly. Do not add logic to it; put it in the service that owns the data.
- **The handlers' shared objects** (`ipc/ipcState.ts`: the session tracker, the pty attachments and
  coalescer, the activity broadcaster, the tab mover) are built in the container too; the handlers
  only subscribe them to events.
- **Layers point down**: `app/` → `ipc/` → services → infra (`.dependency-cruiser.cjs`). A service
  gets config and env values injected (`createUpdater` takes the two fake-update hooks, not
  `RuntimeEnv`); infra takes what it needs of the settings as a narrow interface
  (`windows/windowManager.ts`'s `WindowSettings`, `log/configure.ts`'s `LoggingSettings`).

Why one root and a facade: [ADR-0014](../../docs/adr/0014-one-composition-root-and-appservice-facade.md).

**The refresh reentrancy states and who owns `live` are documented at the top of
`sessionCatalog.ts`; read that before touching either.**

## Chat mode (`chat/`)

The "Run sessions as a chat" setting runs a session the way the VS Code extension does: `claude`
with `--input-format stream-json`, `--output-format stream-json` and `--permission-prompt-tool stdio`, through
the login shell like a terminal (`pty/resumeCommand.ts`'s `buildChatCommand`). The protocol is in
`chat/protocol.ts`, written from what `claude` 2.1.286 actually printed — read its header before
changing anything. Four rules:

- **One process per session.** Two `claude`s on one session both append to its JSONL.
  `ChatService.start` stops a terminal's claude first (`takeOver`, `PtyManager.killAndWait`);
  `resumeInTerminal` stops a chat first; `checkConflict` does not report Apiary's own chat as a
  conflict.
- **The JSONL stays the record.** Streamed messages carry the same uuids the file gets;
  `ChatState.live` only covers the gap until the transcript has read them (`mergeLive`).
- **A message sent mid-turn joins that turn.** Claude takes it in at the next tool result and
  answers it in the same turn — one `result` for both (measured on 2.1.286). It is replayed
  (`isReplay`) when taken in, which is what moves it out of `ChatState.queued`; the file records it
  as an `attachment` of type `queued_command` whose `source_uuid` is the replayed uuid
  (`transcriptReader.ts`'s `queuedMessage`). A turn can also start with nothing sent — a
  background task finishing — so the first streamed message marks the chat busy, not `send`.
  A `result` ends the turn even with a message still queued: a message claude never takes in stays
  in `queued` (its row reads "Queued") without keeping the chat busy. `reduce` drops local commands
  such as `/context` from `queued` at a `result`, because claude never replays them.
- **Send now** (`ChatSession.sendNow`) on a queued message. Idle: it is written at once. Busy: the
  turn is interrupted, the message is held until that turn's `result`, then written, so claude
  answers it as a turn of its own rather than folding it into the stopped one. `ChatSession.read`
  takes the held texts before `reduce` drops the local commands, so a held `/context` is still sent.

- **A subagent's messages are not the session's.** Its tool calls, results and report arrive as
  whole `assistant`/`user` messages marked only by `parent_tool_use_id` (measured on 2.1.288), and
  are written to the subagent's own file. `reduce` drops them, like subagent `stream_event`s.

**Delivery is per window.** A renderer attaches the session its pane shows (`chatAttach`, from
`state/chatStore.ts` when a session's first reader arrives; `chatDetach` when the last leaves) and
`ChatService` sends `chatChanged` only to windows attached to it — or to the session a `/clear`
left, until their tab follows (`windows/windowAttachments.ts`, shared with the ptys). What every
window must hear regardless — a chat started (so a terminal tab for the session goes) or moved
onto a new session — travels as the small `chatLifecycle` event. An exited chat is dropped from
`ChatManager` once no window shows it; while one does, `chatState` still answers with its last state.

`tests/fixtures/fake-claude-chat.mjs` speaks the same protocol for integration and e2e tests.
The whole path, with take-over and `/clear`, is in
[`docs/architecture/chat.md`](../../docs/architecture/chat.md).
