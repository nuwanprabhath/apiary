# src/main/driving: acting on sessions for someone not at the keyboard

Read with root CLAUDE.md. `SessionDriver` (`sessionDriver.ts`) is what Regent will act through: send a
message to a session, start a new session (optionally in a new worktree) with a first message,
interrupt, answer a permission request, and report what watched sessions do (`SessionEvent`).
`app/drivingContainer.ts` (`createDriving`) injects everything it needs; this folder imports only
`chat` and `log`.

## Rules

- **A driven session is always a chat** (`ChatService`): only a chat can be sent to, answered and
  watched cleanly. This is not the scheduled-message path (`scheduleContainer.ts`'s `deliver`), which
  types into a terminal.
- **Folders are opaque ids** (12 hex characters of the SHA-256 of the path). No method takes or
  returns a path; an unknown id is an error naming it.
- **A terminal's session waits for its turn to end** (checked every 5 s, at most 30 minutes), then
  the chat takes it over (`start(id, { takeOver: true })`) and sends. `send` resolves `'waiting'` at
  once; the delivery, or the give-up, comes as an event.
- **A new session is `claude --session-id <uuid>`** (`ChatService.startNew`); a restart of it resumes.
  The store learns of it only when its file is scanned, so `startSession` waits (60 s) and asks the
  catalog to refresh.
- **Watching is observation only**: the driver diffs the states `ChatService.onState` hands it. A
  `/clear` moves a watch to the new id (`moved`). `answer` marks a request as the driver's own, so
  its disappearance is not `permission-gone`.
- **Event text is data.** `turn-ended.text` is a session's words cut to 6000 characters; whoever
  forwards it treats it as untrusted. The log gets ids and counts, never text.

## Tests

`tests/unit/driving/sessionDriver.test.ts` (fake chat, fake clock);
`tests/integration/driving/startSession.test.ts` (real services, `tests/fixtures/fake-claude-chat.mjs`).
