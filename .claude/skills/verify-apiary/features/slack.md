# Slack connection (Regent over Slack)

Apiary reads the owner's messages in one Slack channel and hands them to Regent, which finds or
starts sessions, watches them and posts the milestones back to the message's thread. Polling only
(the Web API every few seconds, never Socket Mode), and only while Apiary is open. Main side:
`src/main/slack/` (its `CLAUDE.md`), `src/main/desk/slackDesk.ts`; the guide is `docs/slack.md`.

## Sub-features

- Settings → Slack (`slack-section`), every field applied at once, never through the dialog's Save:
  - the status line `slack-status`, `data-connection` `off` / `connecting` / `connected` / `error`,
    with one sentence ("Off.", "Connected as @bot in #channel.", "Add the bot token to connect.");
  - the switch "Take instructions from Slack" (no test id: `getByRole('switch', { name })`);
  - the bot token (`slack-token`, `slack-token-save`; once saved `slack-token-saved` and
    `slack-token-replace`, never the token itself; `slack-token-error`; `slack-no-keychain` and a
    disabled field where the OS cannot encrypt it);
  - the channel (`slack-channel`, `slack-channel-error`) and the owner's member id (`slack-owner`,
    `slack-owner-error`), each saved on Enter or blur; `slack-test` (Test connection) and
    `slack-setup-link` (the guide).
- Privacy mode holds the poll until Settings → Privacy allows Slack ([privacy.md](privacy.md)):
  `slack-status` reads `off` with "Waiting for your OK in Settings → Privacy." and the section shows
  a button to Privacy. A grant starts polling within one reconcile; a revoke stops it and keeps the
  setup; an already enabled Slack is migrated to a consent once.
- In Slack: a top-level message from the owner starts a task (an :eyes: reaction), replies in its
  thread belong to it; one older than 15 minutes is asked about first; `stop`, `status`, and
  `allow` / `deny` / `allow all` for a session's permission prompt.
- In Regent's popup a message that came from Slack is labelled `resident-via` ("via Slack"), and
  Apiary's notes are `resident-note` chips ([residents.md](residents.md)).

## How to get to it (user POV)

Settings (Cmd+,) → Slack; settings search finds it by token, channel, bot, member, instructions or
connection. A remote window shows and edits the work machine's.

## Driving it with launchApiary

Open Settings by sending `apiary:open-settings-dialog`, click `settings-nav-slack`. Proof with no
workspace: `slack-status` reads `data-connection="off"`; turning the switch on with no token makes it
`error`, "Add the bot token to connect."; turning it off again makes it `off`.
`drives/features-1-89.verify.ts` does exactly this. `slack.json` in userData holds what was set.

## Gotchas

- Do not save a token from a drive: it is encrypted with Electron's safeStorage, which on macOS
  reaches the real Keychain (a prompt, or a real item).
- Connected, polling, reactions, thread replies and the live "via Slack" path need a real workspace
  (or an HTTP stand-in at `APIARY_SLACK_API`, which nothing in the repo provides): unreachable here.
  The whole flow runs in `tests/integration/desk/slackToSession.test.ts` and
  `regentOverSlack.test.ts` on the in-memory `tests/fixtures/fakeSlack.ts`; its visual states are in
  `tests/component/ui/settingsSlack.ui.test.tsx` and `residentSlack.ui.test.tsx`.
- No e2e spec mirrors it.
