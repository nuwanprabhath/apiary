# Transcript chat

With `transcriptChat` on, a session's transcript is a chat: a composer sends a message, the reply
streams in with tool calls and permission prompts, without starting a terminal.

## Sub-features

- Composer (`composer-input`, `composer-send`, `composer-stop`, model pill `composer-model-pill`,
  slash commands `composer-commands` / `composer-command-search`).
- Timeline (`chat-timeline`, `chat-user`, `chat-text`, `chat-tool` with `data-status`,
  `chat-permission`, `chat-permission-allow`, `chat-streaming`, `chat-queued`).

## How to get to it (user POV)

Settings turns chat mode on; then open a session and type in the box under the transcript.

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

`fake-claude-chat.mjs` replies by keyword: "needs permission" asks for a tool permission, "go
slow" streams slowly (for Stop). Read it for the full list.

Proof: the reply in `chat-text`, `view-transcript` still `data-active="true"`, and
`terminal-session` count 0.

## Gotchas

- Without `claudeBin: FAKE` the default stand-in is a shell, which does not speak stream-json.
