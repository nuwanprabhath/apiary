# Chat mode

Read with root `CLAUDE.md`. This is the path of one chat from the message box to the screen and
back, across main and renderer. Folder detail: [`src/main/chat/CLAUDE.md`](../../src/main/chat/CLAUDE.md)
and [`src/renderer/features/chat/CLAUDE.md`](../../src/renderer/features/chat/CLAUDE.md).

With "Run sessions as a chat" on, the transcript's message box drives the session as a chat instead
of typing into a terminal. Main runs `claude` with `--input-format stream-json`,
`--output-format stream-json` and `--permission-prompt-tool stdio`, through the login shell, and
turns its output into one `ChatState` per session (`shared/domain/chat.ts`).

## The pieces

| Piece | Where | Job |
| --- | --- | --- |
| `ChatService` | `src/main/chat/chatService.ts` | Decides whether and how a chat starts: take-over, working-directory check, permission default, `/clear` adoption, who hears about it |
| `ChatManager` | `src/main/chat/chatManager.ts` | Holds the `ChatSession` of every session by id; `forget` drops an exited one |
| `ChatSession` | `src/main/chat/chatSession.ts` | One `claude` process: stdout to `ChatState`, actions to stdin |
| Protocol | `src/main/chat/protocol.ts` | Pure: parses lines, reduces them into `ChatState`, builds replies |
| `spawnLoginShell` | `src/main/exec/spawnLoginShell.ts` | Starts `claude`; its `exited` promise always settles, even when the spawn fails |
| `WindowAttachments` | `src/main/windows/windowAttachments.ts` | Which window shows which session (shared with ptys) |
| Handlers | `src/main/ipc/handlers/chat.ts` | Adapter from the contract's `chat*` channels to `ChatService` |
| `chatStore` | `src/renderer/state/chatStore.ts` | Keyed store (`createKeyedIpcStore`) plus the chat commands |
| `useChatTakeover` | `src/renderer/features/workspace/useChatTakeover.ts` | Keeps tabs in step with chats started or moved anywhere |

## One message, end to end

1. The composer (`features/transcript/Composer.tsx`) calls `startChat` then `sendChat` from
   `chatStore`. Both are awaited, so a failure keeps the text in the box.
2. The handler calls `ChatService.start`. If a chat is already running it is returned. If the
   session runs in a terminal, `takeOver` must be true; then `PtyManager.killAndWait` stops that
   terminal first. The folder must still exist. The permission mode is the composer's pick, or
   `chatStartMode` (`auto` unless Claude Code's own settings choose one).
3. `ChatManager.start` builds the command (`buildChatCommand`) and starts it with `spawnLoginShell`.
4. `ChatSession` writes the user line to stdin and reads stdout. Streamed text is emitted at most
   every 40 ms. Every state goes to `ChatService.onChanged`.
5. `onChanged` sends `chatChanged` only to windows attached to that session, and announces
   `chatLifecycle` to every window when the chat started, moved or ended.
6. The renderer's `chatStore` applies the push to that session's key. Only that session's readers
   re-render.

The session's JSONL stays the record. Streamed messages carry the uuids the file gets; `ChatState.live`
only covers the gap until the transcript has read them (`mergeLive` in `shared/chatTimeline.ts`).

## Delivery is per window

A chat streams about 25 pushes a second. Sending that to every window woke every pane.

- A renderer sends `chatAttach(sessionId)` when a session's key gets its first reader in
  `chatStore`, and `chatDetach` when the last reader leaves. Attach is sent before the state is read,
  and IPC from one renderer is ordered, so no update falls between the two.
- `ChatService.attach` and `detach` record it in `WindowAttachments`. A closed or reloaded window is
  dropped by `windowLifetimeWatcher`; a reloaded renderer re-attaches as its panes mount.
- `chatChanged` goes to the windows attached to the session, and to those still attached to the
  session a `/clear` left (`previousSessionId`).
- `chatLifecycle` is the small event every window hears. A tab in a background pane shows no chat and
  is attached to none, but it must still drop a dead terminal or follow a chat that moved.
- A background tab fetches `chatState` when it becomes the active tab.

An exited chat is dropped from `ChatManager` once no window shows it (`ChatService.sweep`). While a
window shows it, `chatState` still answers with its last state, error text included.

## Take-over

A session runs in one place at a time: two `claude` processes on one session both append to its
JSONL.

- Chat over a terminal: `start` with `takeOver` stops the terminal first. The composer only does
  that when `terminalBusy` says the terminal is idle with no background tasks. A busy terminal gets
  the message typed into it instead.
- Terminal over a chat: `ChatService.resumeInTerminal` stops the chat first.
- `checkConflict` does not report Apiary's own chat as a conflict.
- `useChatTakeover` reacts to `chatLifecycle`: a session that starts as a chat loses its dead terminal
  tab (the Resume button comes back).

## `/clear` adoption

`/clear` makes `claude` continue the chat on a new session id.

1. `ChatSession` mints the new `SessionId` (after the UUID check) and the manager re-files the chat
   under it. The state now names `previousSessionId`.
2. `ChatService.onChanged` remembers the new id in `adoptions` and sends the state to both keys.
3. `claude` writes the new session's file only with its first message. When the scan has found it,
   `adoptSessions` marks it imported, so it is part of the library even in a folder without
   auto-import. Once adopted, it stays adopted: archiving it later is not undone.
4. `useChatTakeover` waits on the tree (`treeStore.onChanged`) for the new session, then dispatches
   the workspace action chat/follow, which moves the tab onto it.

Why per window: [ADR-0015](../adr/0015-chat-state-delivered-per-window.md).

## Hiding tool calls

`Transcript` can draw the conversation without its tool calls. `withoutToolCalls`
(`src/shared/chatTimeline.ts`) drops every `tool_use` and `tool_result` block, and a message left
with nothing, from the file's messages and from `ChatState.live`, before `chatItems` pairs them; the
background-task and turn status still read the unfiltered messages. Whether it applies is
`useChatSettings` (`src/renderer/state/chatSettingsStore.ts`): the `hideToolCallIo` global setting,
unless overridden by a per-chat choice that persists for that session only. The per-chat choice is
kept in an in-memory store that starts fresh each window. A permission prompt is not a tool call box
and always shows.

## Tests

- `tests/fixtures/fake-claude-chat.mjs` speaks the protocol, for integration and e2e.
- `tests/unit/chatProtocol.test.ts`, `tests/unit/chatService.test.ts` (take-over, pruning, delivery),
  `tests/unit/chatSpawnError.test.ts`, `tests/integration/chatManager.test.ts`.
- `tests/component/transcriptChat.test.tsx`, `tests/e2e/transcriptChat.spec.ts` (including `/clear`).
- `tests/component/toolIoToggle.test.tsx` and `tests/unit/chatTimeline.test.ts` for hiding tool calls.
- The contract suite (`tests/contract/clauses/chat.ts`) runs a chat against the fake and against real
  main (with `tests/fixtures/fake-claude-chat.mjs`): start, send, mode, stop, who hears `chatChanged`
  (only a window that attached the session) and `chatLifecycle` (every window), and that an ended chat
  is forgotten once no window shows it.
