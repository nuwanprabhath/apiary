# Which session a terminal is on

Read with root CLAUDE.md; this covers how Apiary tracks a live pty's Claude session id across
`/clear`, `/resume` and `/fork`. See also [activity.md](activity.md) and
[windows-and-tabs.md](windows-and-tabs.md).

**Ask Claude, don't guess.** Claude Code keeps `<config>/sessions/<pid>.json` for every interactive
process — `sessionId`, `name`, `nameSource` (`user` or `derived`), `status` — and a session's pty
pid *is* Claude's pid (sessions run under `exec`). `ClaudeSessionTracker` polls those files for live
TUI ptys; `features/workspace/useSessionFollowing.ts` rekeys any tab whose pty is on another session
the tree knows. Measured on real
Haiku sessions (Claude 2.1.281):

- the file exists from startup, but the session's **JSONL only appears on the first message** —
  so the tracker learns an id before the tree has it, and the rekey has to re-check on tree changes;
- `/clear` and `/resume` change `sessionId` **in place**, on the same process;
- `/rename` changes `name` and appends a `custom-title` record to the JSONL;
- `--fork-session` copies the parent's `custom-title`; `/fork` (2.1.281) starts a *separate*
  background session and leaves the process where it was;
- the file is removed when the process exits;
- a **fork nobody has typed in has no JSONL at all** (a `/rename` makes Claude write one), so
  until then the tab is pending: Active names it from the tab's reported `label`, and renaming it
  sends `/rename` through `renameTerminalInClaude(ptyId)` — the tab then resolves on its own.

Shell terminals are filed under the pty a tab runs under (`keyFor` = `ptyOverrides.get(key) ??
key`), not the tab key — a rekey must leave `shellTabs` alone. And shells do not survive a quit
while the layout still lists them: `features/pane/useShellTerminals.ts` restarts a shown terminal whose pty is not
running, rather than attaching to nothing.

Before this, a new or forked tab was matched by waiting for an unseen JSONL in its folder. `/resume`
inside a new session switches to a session that already existed — the one case that match rules
out — and the tab stayed a `new:<uuid>` pty forever: unpinnable, missing from Recent, its pty id in
Active, Fork disabled.

**Inherited markers turn transcripts off.** An Apiary started from a shell Claude Code opened
inherits `CLAUDE_CODE_CHILD_SESSION` and friends, and a child `claude` that sees it writes no JSONL
and no session file. `pty/childEnv.ts` strips an explicit list; do not widen it to every
`CLAUDE_CODE_*` (that would drop real config like `CLAUDE_CODE_USE_BEDROCK`).

**Verify against a real session.** `tests/e2e/live/` drives a real `claude --model haiku` through
the built app (`APIARY_LIVE_CLAUDE=1 npm run test:e2e -- live/`; opt-in, spends tokens). The
stand-in spec (`sessionFollowing.spec.ts`) passed on the first version of this fix, whose session
already existed; the live spec failed it at once, because real Claude writes the JSONL later. When
driving the TUI: the trust prompt defaults to "No, exit" (Down, Enter), and a resumed or forked
screen repaints old "done" lines, so wait for a *new* one before typing again.
