# src/main/desk: Regent's desk over Slack

Read with root CLAUDE.md, [`src/main/slack/CLAUDE.md`](../slack/CLAUDE.md),
[`src/main/driving/CLAUDE.md`](../driving/CLAUDE.md) and
[`src/main/residents/CLAUDE.md`](../residents/CLAUDE.md). The desk joins them: what the owner writes
in this machine's Slack channel reaches Regent, and what Regent and the sessions it drives do comes
back to the task's thread.

- `desk.ts`: `DeskParts` (the bridge, the driver, the residents) and `startDesk`, which starts every
  `DeskPiece` in `DESK_PIECES`, then starts the bridge's poller (so no message arrives before a
  handler exists), and returns one disposer. `index.ts` calls it where it used to start the bridge.

- `slackDesk.ts`: Regent's piece. Handler at order 100 sends every message to Regent as `[Slack task <thread>]`;
  session events and other residents' answers reach Regent as notes with their words fenced `<<<UNTRUSTED`;
  a Slack turn that ended without `slack_post` has its text posted. Hands `residents.setDesk` the controls.
- `deskControls.ts`: the `DriveControl` / `SlackControl` adapters over the driver and the bridge.
- `commands.ts` (order 10): a top-level `status` and a `stop` reply in a task's thread, with no model.
- `approvals.ts` (order 20): a watched session's permission prompts and questions, and a task's
  residents' approval cards, posted to the thread in main's words; `allow`, `deny`, `allow all` and
  question answers typed back. `allow all` never covers a question or a resident's card.
- `deskPiece.ts`: the `DeskParts` and `DeskPiece` types. `DESK_PIECES` runs commands, approvals,
  then Regent's piece, so the cheaper handlers see a message first.

The folder imports `driving`, `log`, `residents` and `slack`; nothing imports it but `app`.

## Add a piece

A function `(parts: DeskParts) => () => void` in its own file, added to `DESK_PIECES`. It hangs
handlers on `parts.bridge.handle(order, fn)` and listeners on the driver and residents, and returns
a function removing all of them.
