# The diagnostic log

Read with root CLAUDE.md; this covers `src/main/log/` — when it writes, what it must never contain,
and where redaction happens. See also root CLAUDE.md's hard rule: "the diagnostic log never
receives conversation content."

`src/main/log/` writes a local log when the user switches it on in Settings → Diagnostics. It
exists because "Open installer" failed on a user's Ubuntu with an Electron IPC message, every
hypothesis was disproved in a container, and the app had recorded nothing about what it tried.

Four rules, and they are the feature rather than decoration:

- **Off is the default, and off means nothing** — no directory, no file, `log()` returns
  immediately. A diagnostic that writes by default records things nobody agreed to.
- **Conversation content is never passed to it.** Not redacted — never passed. No amount of
  scrubbing makes a transcript safe to hand to someone else, so prompts, replies and message text
  simply do not go in. Log *what the app did*, never *what the user said*.
- **Redaction happens inside the logger** (`src/shared/redact.ts`), not at call sites, so it cannot
  be forgotten: home directories become `~`, credential-shaped strings are stripped, long fields
  are truncated. Add a rule there and every existing call gets it.
- **It must never break the app.** Every entry point swallows its own errors. A full disk stops
  logging; it does not stop the thing being logged.

**Redaction rules** (`redactString`): credentials; emails become `[email]`; a `user@host:` or
`ssh://user@host` remote becomes `[user]@…` (the shared `git@` account is kept); home roots
(`/Users/<u>`, `/home/<u>`, `/var/home/<u>`, `/root`, `C:\Users\<u>`) become `~`. Keep each rule
narrow and test its false positive (`tests/unit/redactPrivacy.test.ts`).

**Privacy (strict) mode** (`LoggerOptions.strict`, set by `configureLogging` from `gdprStrictMode`
on every settings save): fields named `text`, `message`, `body`, `prompt`, `content`, `reply` or
`query` (any case) are dropped, never the fixed `msg`; strings are cut at 200 characters, not 512;
`host`, `hostname` and `remote` become `host-<8 hex of sha256(salt + value)>`, the salt 32 random
bytes in a `.salt` file in the log folder (0600), made with the folder and removed by `clear`. Retention is
`min(logRetentionDays, 7)` (`effectiveLogRetentionDays`); the stored setting is unchanged.

When adding a log line, ask what a stranger reading this file would need to tell two
explanations apart — that is the bar the "Open installer" bug set, and failed. The existing lines
are placed at exactly the points where earlier bugs were invisible: pty spawn/exit and the
attach-instead-of-spawn case, the prompt-trim environment, what the updater handed to the
desktop and what came back, which window a cross-window drop resolved to, and every IPC rejection.
Since then: every pty's move to another Claude session (`session-tracker`) and the renderer
rekeying a tab to follow it (`tabs`), whether an Apiary rename reached Claude and why not
(`rename`), each fresh merge-request lookup and what it replaced (`mr-status`), links opened in the
browser or blocked (`navigation`), and which inherited Claude markers a spawn stripped.
