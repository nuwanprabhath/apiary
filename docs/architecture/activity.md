# Activity classification

Read with root CLAUDE.md; this covers how a tab's status dot (running / waiting / idle / stopped)
is computed. See also [windows-and-tabs.md](windows-and-tabs.md) for the registry that surfaces it.

**`classifyActivity` reads a rendered screen, never the raw pty stream.** That distinction is the
whole subsystem, and it cost two shipped bugs to learn. Claude Code is a full-screen TUI: it
repaints in place, and it positions each word by jumping the cursor (`ESC[12G` between words)
rather than printing spaces. So `Do you want to proceed?` **never appears as those bytes in that
order anywhere in the stream** — a literal match against the stream cannot fire and never did — and
the stream's newlines are not screen lines, so "the last twelve lines" reached back across the
whole session. Every match the old classifier made came from a loose "line ending in a question
mark" fallback, which matched Claude's own prose and the echoed user prompt. The visible result was
an amber "asking you something" dot on a session sitting idle.

`src/main/pty/screen.ts` fixes it at the source: `ScreenBuffers` keeps a headless xterm per pty,
fed each chunk as it arrives, and `PtyManager.screen(id)` reads its grid as plain text. This is
also *cheaper* than what it replaced — the old code ran a global regex and a split over the whole
256KB replay buffer on every poll. `screen()` is that rendered picture, for code that wants to
*read* the terminal; `snapshot()` (see [windows-and-tabs.md](windows-and-tabs.md)) is the same
rendering, handed to a view that wants to *paint* it.

`src/shared/activity.ts` then works on plain text, in this order: `stopped` if the pty is gone,
`waiting` at an unmistakable prompt (`Do you want to proceed?`, a confirm footer, a `❯ 1.` option
cursor), `running` if the spinner shows a live elapsed timer in parentheses (`(2s · thinking)` —
the finished form `✻ Cooked for 2s · done` has none), `running` if anything was printed in the last
two seconds (which is what covers a tab running something that is not Claude), `idle` otherwise.
Only the bottom fifteen non-blank lines are scanned, because that is where the furniture lives and
everything above it is conversation.

**Do not add a "looks like a question" heuristic back.** That was the bug, twice.

**The tests for this are recordings, not inventions.** `scripts/capture-activity-fixtures.mjs`
drives a real `claude --model haiku` through a pty and snapshots the raw buffer at named moments
into `tests/fixtures/activity/` (a `.txt` of bytes, and a `.json` carrying `sinceLastOutputMs` —
the other half of the classifier's input). `tests/unit/activityFixtures.test.ts` renders each one
and asserts its status. Run the capture deliberately, never in CI: it spends real tokens. Add a
scenario by recording it. Hand-written fixtures are what let this ship broken twice — the same
assumption wrote the fixture and the pattern, so they agreed with each other and with nothing else.

The dots are colour *and* motion: a slow breath for `running`, a double-knock pulse plus a marked
row for `waiting`, stillness for `idle` and `stopped`. `ActivityLegend.tsx`, on the Active header,
is the only place that vocabulary is explained — it draws real `.status-dot`s so the legend
animates exactly as the rows do.
