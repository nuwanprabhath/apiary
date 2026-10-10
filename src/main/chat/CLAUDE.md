# src/main/chat: chat mode in the main process

Read with root CLAUDE.md. The whole path from the message box to the screen is in
[`docs/architecture/chat.md`](../../../docs/architecture/chat.md); this is what to know before
editing the files here. Protocol rules (one process per session, the JSONL stays the record, a
message sent mid-turn, subagent messages) are in [`src/main/CLAUDE.md`](../CLAUDE.md).

## What lives here

- `chatService.ts`: `ChatService`. Decides whether and how a chat starts (take-over, folder check,
  permission default), the actions, `terminalBusy`, `/clear` adoption, per-window delivery and
  pruning of exited chats.
- `chatManager.ts`: `ChatManager`. The chats by session id. Holds processes; decides nothing.
- `chatSession.ts`: `ChatSession`. One `claude` process; stdout to `ChatState`, actions to stdin.
- `protocol.ts`: the stream-json protocol, pure. Read its header before changing anything.
- `startMode.ts`: `chatStartMode`, the permission mode a chat starts in.

## The sanctioned way

- **A new chat action** (a control request, a setting): add the line builder to `protocol.ts` and a
  method to `ChatSession`, `ChatManager` and `ChatService`; add the `chat*` channel and its handler
  with `npm run new -- ipc <name>`; add a command in `src/renderer/state/chatStore.ts`.
- **A new thing to read from claude's output**: extend `reduce` in `protocol.ts` and the fields of
  `ChatState` in `shared/domain/chat.ts`. Measure the real output first and put the claude version in
  the comment, as the existing cases do. Unknown lines must leave the state as it was.
- **Starting the process**: only through `spawnLoginShell`. Never `child_process` here (`no-raw-subprocess`).
- **Who hears a state**: `ChatService.onChanged` sends `chatChanged` to attached windows and
  announces `chatLifecycle` to all. Do not call `broadcast` for chat state.
- **Construction**: `ChatManager` and `ChatService` are built in `createContainer` only.

## Tests

- `tests/unit/chatProtocol.test.ts`: the reducer, from recorded lines.
- `tests/unit/chatService.test.ts`: take-over, adoption, per-window delivery, pruning.
- `tests/unit/chatSpawnError.test.ts`: a spawn that fails ends the chat as `exited`.
- `tests/integration/chatManager.test.ts`, `tests/integration/chatStartMode.test.ts`: a real process
  (`tests/fixtures/fake-claude-chat.mjs`) and the settings files.
- `tests/e2e/transcriptChat.spec.ts`: the real app, including `/clear`.

## Pitfalls

- **Non-JSON lines are normal.** A login shell can print before `exec`; `parseLine` returns null.
- **Our own `stop()` is never an error.** claude exits 143 on SIGTERM instead of dying of the
  signal, so `ChatSession` sets `stopping` and treats any exit after it as clean.
- **`exited` is final.** `ChatSession.update` ignores everything after it: a reply to a request that
  was in flight (`initialize`) settles after the exit and used to emit the exited state again, so
  `chatLifecycle {running:false}` went out twice. A new run is a new `ChatSession`.
- **A failed start must still end the chat.** `proc.exited` settles on spawn errors too; without
  that, `stopAll` hangs and the app cannot quit. A stdin write after exit is swallowed by a listener.
- **Two `claude`s on one session corrupt the file.** Stop the terminal before a chat starts and the
  chat before a terminal resumes; `checkConflict` must not count our own chat.
- **A `/clear` changes the session id mid-chat.** The manager re-files the chat; both keys receive
  the state until the tab follows. Mint the new id once, after the UUID check, with `asSessionId`.
- **A turn can start with nothing sent** (a background task finished), so busy starts at the first
  streamed message, not at `send`.
- **Only the newest 200 streamed messages are kept** (`MAX_LIVE`); the transcript has read the rest.
- **A `result` ends the turn even with a queued message pending.** A message claude never takes in
  stays `queued`, and must not keep the chat busy, or the working line stays on after the turn.
- **An interrupt keeps a queued message claude had not taken in.** It stays `queued`, and Send now
  sends it as a turn of its own (`tests/integration/chatManager.test.ts`).
- **A window's attachments follow the page it shows.** A link clicked in a reply starts a navigation
  that the guard cancels, so `windowLifetimeWatcher` listens to `did-navigate`, not
  `did-start-navigation`, or the chat stops reaching the window
  ([windows and tabs](../../../docs/architecture/windows-and-tabs.md)).
- **An exited chat nobody shows is forgotten**, so its error text is gone when a tab opens later.
- **The default mode is `auto`** unless Claude Code's own settings pick one
  ([ADR-0017](../../../docs/adr/0017-chat-defaults-to-auto-permission-mode.md)).
