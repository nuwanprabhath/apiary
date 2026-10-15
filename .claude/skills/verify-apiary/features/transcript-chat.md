# Transcript chat

With `transcriptChat` on, a session's transcript is a chat: a composer sends a message, the reply
streams in with tool calls and permission prompts, without starting a terminal.

## Sub-features

- Composer (`composer-input`, `composer-send`, `composer-stop`, model pill `composer-model-pill`,
  slash commands `composer-commands` / `composer-command-search`).
- Timeline (`chat-timeline`, `chat-user`, `chat-text`, `chat-tool` with `data-status`,
  `chat-permission`, `chat-permission-allow`, `chat-streaming`, `chat-queued`). Every message has a
  `message-time`; a reply's is `.message-time-inline`, floated right on its first line.
- Model and effort (`composer-model-pill` opens `composer-model-menu`, the effort row
  `composer-effort` with `composer-effort-<level>`).
- Folding the box (`composer-collapse`, `aria-expanded`; while folded the textarea is gone and
  `composer-peek` shows "Message Claude…" or the draft's first line, and unfolds with focus in it).
- The "/" menu's Actions group: "Open in VS Code" (`composer-action-option`), shown only when VS
  Code is available and the folder exists; it calls `openInVsCode` for the session.
- History: Up on the box's first line recalls the previous message sent to the session (from its
  file, `sentPrompts`), Down on the last line comes forward, past the newest the draft returns
  (`useSentHistory`). The "/" menu takes the arrows first while it is open.
- Folding the box is per pane (each column's own; `composer-collapse` in one pane leaves the others).
- Claude's questions (`AskUserQuestion`): `chat-question-card` instead of `chat-permission`, one
  `chat-question` per question with option rows, `chat-question-other` (a text field), and
  `chat-question-submit` / `chat-question-skip`. The allow carries `answers` (question text to
  label, multi-select joined with ", "); the timeline row reads "Q: … → A: …".
- Background tasks: `chat-status-tasks` is a button opening a popup of `chat-task` rows
  (`chat-task-elapsed`); opening a row shows `chat-task-output`, read by main
  (`backgroundTaskOutput`) from the file the session's transcript names. A task stopped with
  `TaskStop`/`KillShell` leaves the list.
- Hide tool calls: library state's `hideToolCallIo` (and each chat's `showToolCalls` in
  `chatSettings`), in `library-state.json`, not `settings.json`.

## How to get to it (user POV)

Settings → General → "Run sessions as a chat, like the VS Code extension"
(`setting-transcript-chat`); then open a session and type in the box under the transcript.

## Driving it with launchApiary

```ts
import { fileURLToPath } from 'node:url'
const FAKE = fileURLToPath(new URL('<repo>/tests/fixtures/fake-claude-chat.mjs', import.meta.url))
const h = await launchApiary({ claudeBin: FAKE, settings: { transcriptChat: true } })
await importAll(h.page); await h.page.getByTestId('sidebar-refresh').click()
await sidebarSession(h.page, 'Fix CSV export bug').click()
await h.page.getByTestId('composer-input').fill('hello')
await h.page.getByTestId('composer-input').press('Enter')
await expect(h.page.getByTestId('chat-text').last()).toContainText('You said: hello')
```

`fake-claude-chat.mjs` replies by keyword: "permission" asks for a tool permission, "slow" streams
slowly (for Stop), "background" starts a background task, "linger" holds the turn open. Read its
header for the full list.

Proof: the reply in `chat-text`, `view-transcript` still `data-active="true"`, and
`terminal-session` count 0.

## Gotchas

- Without `claudeBin: FAKE` the default stand-in is a shell, which does not speak stream-json.
