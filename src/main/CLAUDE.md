# src/main — the Electron main process

Read with root CLAUDE.md; this covers settings storage and IPC, and points at the deeper homes for
each subsystem. Subfolders with their own `CLAUDE.md`: [`pty/`](pty/CLAUDE.md),
[`search/`](search/CLAUDE.md), [`store/`](store/CLAUDE.md), [`update/`](update/CLAUDE.md),
[`plugins/`](plugins/CLAUDE.md), [`log/`](log/CLAUDE.md). Windows and tabs
(`windows/`) live in [docs/architecture/windows-and-tabs.md](../../docs/architecture/windows-and-tabs.md)
because that topic spans main and renderer.

`src/main/ipc/registrar.ts` wires every handler in `ipc/handlers/*.ts` against
`shared/ipc/contract.ts`; see root CLAUDE.md's "How to add… an IPC call" recipe before adding one.

## Settings

`main/settings.ts` defines `AppSettings` (extends the shared `AppSettingsPayload`),
`DEFAULT_SETTINGS`, `SETTINGS_VERSION` and `migrateSettings`; `settings/settingsService.ts` owns the
loaded instance and `mergeSettingsPayload` (also in `main/settings.ts`); `ipc/handlers/settings.ts`
is the `settingsGet`/`settingsSet` IPC surface.

**Changing a default reaches nobody.** `saveSettings` writes the **whole** settings object
(atomically — tmp file then rename, so a crash mid-write cannot corrupt it), and the app writes it
whenever the first window is moved or resized. So every `settings.json` in existence already pins
every field to whatever the default was on the day it was first written, and **changing
`DEFAULT_SETTINGS` only ever affects someone who has never run the app**. This was found the slow
way: the prompt trim was "defaulted on" in 1.13.2 and nothing changed for anyone.

Changing a default for existing users means a migration: bump `SETTINGS_VERSION`, extend
`migrateSettings`, and only touch values that are still exactly what the old default was — someone
who chose a value has said what they want. The migrated result is written back at startup, or it
would be re-applied on every launch and undo a later deliberate change.

**Settings arriving over IPC: a missing field means "unchanged", never `false`.**
`AppSettingsPayload` is typed, but it crosses a process boundary from a renderer that is not
guaranteed to be the same build as the main process — a dev reload, or an update that reloads the
window. A key the sender has never heard of is simply absent, so `mergeSettingsPayload` treats a
missing field as "unchanged" rather than as `false`. Getting it wrong once cost a whole afternoon,
because the failure hides itself — the feature switched off in memory, its index was wiped as a
switch-off is meant to do, and `JSON.stringify` dropped the undefined key so the file on disk still
said the feature was on.

## Composition and the session services

`app/container.ts`'s `createContainer(env, paths, inputs)` is the one place every long-lived
main-process object is constructed (pure construction: no windows, timers or refresh; `index.ts`
resolves what needs Electron and starts things in order). `AppService` is a facade over
`sessions/sessionResolver.ts` (trust boundary), `sessions/sessionCatalog.ts` (refresh loop and the
`live` map) and `sessions/sessionActions.ts` (rename/note/remove/move) plus the git, search,
terminal, image and VS Code services. **The refresh reentrancy states and who owns `live` are
documented at the top of `sessionCatalog.ts`; read that before touching either.**

## Chat mode (`chat/`)

The "Run sessions as a chat" setting runs a session the way the VS Code extension does: `claude`
with `--input-format stream-json`, `--output-format stream-json` and `--permission-prompt-tool stdio`, through
the login shell like a terminal (`pty/resumeCommand.ts`'s `buildChatCommand`). The protocol is in
`chat/protocol.ts`, written from what `claude` 2.1.286 actually printed — read its header before
changing anything. Four rules:

- **One process per session.** Two `claude`s on one session both append to its JSONL.
  `AppService.chatStart` stops a terminal's claude first (`takeOver`, `PtyManager.killAndWait`);
  `resume` stops a chat first; `checkConflict` does not report Apiary's own chat as a conflict.
- **The JSONL stays the record.** Streamed messages carry the same uuids the file gets;
  `ChatState.live` only covers the gap until the transcript has read them (`mergeLive`).
- **A message sent mid-turn joins that turn.** Claude takes it in at the next tool result and
  answers it in the same turn — one `result` for both (measured on 2.1.286). It is replayed
  (`isReplay`) when taken in, which is what moves it out of `ChatState.queued`; the file records it
  as an `attachment` of type `queued_command` whose `source_uuid` is the replayed uuid
  (`transcriptReader.ts`'s `queuedMessage`). A turn can also start with nothing sent — a
  background task finishing — so the first streamed message marks the chat busy, not `send`.

- **A subagent's messages are not the session's.** Its tool calls, results and report arrive as
  whole `assistant`/`user` messages marked only by `parent_tool_use_id` (measured on 2.1.288), and
  are written to the subagent's own file. `reduce` drops them, like subagent `stream_event`s.

`tests/fixtures/fake-claude-chat.mjs` speaks the same protocol for integration and e2e tests.
