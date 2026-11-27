# src/main/slack: the Slack connection

Read with root CLAUDE.md. Apiary's main process talks to Slack's Web API over an injected `fetch`
(no SDK), reads the owner's messages in this machine's channel and can post. Setup for a person:
[docs/slack.md](../../../docs/slack.md). Later packages hang handlers on `SlackBridge.handle`.

- `slackApi.ts`: `SlackApi` and `createSlackApi`; `SlackApiError` and `describeSlackError` (one sentence a person can act on).
- `slackText.ts`: Slack text to plain, Markdown to mrkdwn, `#12`/`!34` linked (`linkReferences`, over `findMentions`), long text split (never inside a code fence). Pure.
- `slackStore.ts`: the state file slack.json in userData (a `JsonStore`): the token **encrypted** by a `CodeCipher` (`fs/codeCipher.ts`), channel, owner id, cursor, tasks, awaiting.
- `slackTasks.ts`: `SlackTasks`, one task per thread; every change is saved.
- `slackPoller.ts`: pure rules (who counts, stale, yes/no, poll delay). `slackBridge.ts`: the timer and the cycle.

The folder imports only `fs` and `log`: the cipher, the clock, `fetch` and the wake hook are injected by `app/slackContainer.ts`.

## Rules

- Polling only, never Socket Mode: Slack delivers a Socket Mode event to one connection, so two machines would steal each other's messages.
- One timer, re-armed after a cycle ends; never two cycles at once. 429 waits `Retry-After`, any other failure 60 s.
- Only the owner's plain messages (no `bot_id`, no `subtype`) are instructions. First run: the cursor is now.
- The cursor and `lastReplyTs` move only after a message was handed over.
- The token is never in a status, a log line, `settings.json` or a renderer. Log counts and codes, never text.
- Receipts. Every owner message Apiary takes (a top-level one and a reply in a task's thread, each on its own `ts`)
  gets `eyes` and goes on its task's `receipts`. It is **actioned**, and its `eyes` become `white_check_mark`, when
  `bridge.post` to its thread succeeds after it was taken (a reply answering it: Regent's `slack_post`, the
  summary, the auto-reply, `status` or `stop`), when its task finishes (`bridge.finish`), or when a handler names it
  (`actioned(thread, ts)`: an approval answered). A card or notice posted with `answers: false` is Apiary asking,
  not answering, and ticks nothing. A post ticks every message waiting in the thread, so a reply sent while Regent
  is still answering the one before is ticked with it. Reactions are a courtesy: each failure is ignored, and
  `already_reacted` / `no_reaction` are not errors (`reactions:write` covers add and remove).
- Posts link bare `#12` and `!34` to the repository `linkReferences(repo)` names for the thread (the desk's
  `references` piece); none named, no links. Code, `<…>` links and Markdown links are never linked again.

## Add a method or a handler

A Slack method: a function on `SlackApi` (and `createSlackApi`, and `tests/fixtures/fakeSlack.ts`), with its `SlackApiError` mapping in `describeSlackError`.
A handler: `bridge.handle(order, fn)`; return true to consume. Lower `order` is asked first.
A new IPC call: `npm run new -- ipc <name>`, its clause in `tests/contract/clauses/slack.ts`, its fake in `tests/component/fake/slack.ts`.

## Pitfalls

- A message in the same millisecond as the first-run cursor is skipped (`compareTs` is `<=`); tests advance a tick after starting.
- `configure` verifies (`auth.test` and a one-message history) before it answers, so a status is `connected` when it returns.
