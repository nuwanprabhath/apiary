# Debugging: traps and the measure-before-fixing discipline

## `ELECTRON_RUN_AS_NODE`

If Electron's binary has been run as a plain Node interpreter in your shell, this variable is set
and is inherited by everything started from it. Every Playwright launch then dies with
`Process failed to launch` and `electron does not provide an export named 'BrowserWindow'` — an
error that looks nothing like its cause. `tests/e2e/helpers.ts` strips it from the launch
environment, so this should stay fixed; if you see that error anywhere else, check the variable
first.

## Measure before fixing

The bugs in this app that took longest were the ones where a plausible explanation was acted on
without checking.

- The terminal-cutoff bug was "fixed" twice before someone measured the actual element heights and
  found a 352px terminal inside a 167px row.
- The "needs Enter twice" bug got a delay-tuning fix that was irrelevant, because the real cause
  was a write landing a second before the program existed — found only by tapping the PTY and
  looking at the bytes.
- "Notes are saved but never indexed" was found by reading the user's actual `apiary.db` and
  `search.db` (both under Electron's `userData` directory — see root CLAUDE.md's "Environment
  variables and on-disk state") and running the app's own sync against a copy of them, which
  showed the code worked and the *state* was wrong.

One trap while doing that: `sqlite3 -readonly` cannot open the `-shm` file, so it silently ignores
everything in the WAL and reports an out-of-date picture of the database. Copy the `.db` and
`-wal` together (never the `-shm`) and read the copy.

Both are cheap to do: a short script with `node-pty`, a `getBoundingClientRect` in the devtools
console, a `tail` of what the child actually received. Do that before changing code, and say what
you measured — in the commit message or the changelog entry, for a performance finding.
