# src/main/desk: Regent's desk over Slack

Read with root CLAUDE.md, [`src/main/slack/CLAUDE.md`](../slack/CLAUDE.md),
[`src/main/driving/CLAUDE.md`](../driving/CLAUDE.md) and
[`src/main/residents/CLAUDE.md`](../residents/CLAUDE.md). The desk joins them: what the owner writes
in this machine's Slack channel reaches Regent, and what Regent and the sessions it drives do comes
back to the task's thread.

- `desk.ts`: `DeskParts` (the bridge, the driver, the residents) and `startDesk`, which starts every
  `DeskPiece` in `DESK_PIECES`, then starts the bridge's poller (so no message arrives before a
  handler exists), and returns one disposer. `index.ts` calls it where it used to start the bridge.

The folder imports `driving`, `log`, `residents` and `slack`; nothing imports it but `app`.

## Add a piece

A function `(parts: DeskParts) => () => void` in its own file, added to `DESK_PIECES`. It hangs
handlers on `parts.bridge.handle(order, fn)` and listeners on the driver and residents, and returns
a function removing all of them.
