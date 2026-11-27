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
- "Open in VS Code" in the "/" menu's Actions group (below), shown only when VS Code is available
  and the folder exists; it calls `openInVsCode` for the session.
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

- The "/" menu's Actions group (`composer-action-option`, select one by `data-action`): account,
  reload-session, schedule-message, open in VS Code (`PALETTE_ACTIONS`, `paletteActions.ts`), next
  to Claude's own commands.
- `composer-mode`; permission prompts (`chat-permission-allow`/`-deny`); tool calls
  (`chat-tool-in`/`-out`); background tasks (`chat-status-tasks`, "1 background task running", with
  each agent's model and effort in its popup; `chat-task-stop`, or Delete, stops one).
- A message sent while the session works in its terminal is typed into that terminal, and shows as
  a `chat-queued` row reading "Queued in the terminal" (no Send now) until the file has it.
- Right-click in the chat: Copy, and "Copy link address" on a link (`context-menu-copy-link`).
- `/btw <question>`: a side question in its own card (`chat-aside*`); `/mcp`: the servers card
  (`chat-mcp*`); `/login`: a terminal under the session's account. A session on another account than
  the default shows `chat-account-pill`.
- A brand-new session can start in the chat (`pending-chat`, setting `setting-new-sessions-in-chat`).
- A note Claude Code draws only in its terminal ("✦ Heads up · …", "✦ You should know · …") shows
  over the message box while the session's claude runs in a terminal: `chat-terminal-notice`, its
  answers `chat-terminal-notice-choices`, and `chat-terminal-notice-open` (Answer in the terminal)
  switching the tab to Terminal. Main reads it off the pty's screen (`src/shared/terminalNotice.ts`)
  and sends it as the tab's `notice` in `activeTabs`. Driven with a stand-in claude that prints the
  note (`features-1-91`); the default stand-in, a shell, never draws one.
- A code block's Copy (`code-copy`) sits over its top-right corner and the code starts below it:
  measure that no line's client rect meets the button at `scrollLeft` 0 and at the far end.

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
