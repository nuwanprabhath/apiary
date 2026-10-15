# Per-session Claude accounts

Status: approved design, 2026-10-15. Target version 1.43.0.

## Goal

A user with several Claude accounts (for example personal and work) can choose which account each
Apiary session runs under, without switching the account for the whole machine the way
`cswap switch` does. New sessions start in a default account chosen in Settings. Any session can
move to another account from the `/` menu (chat mode) or the tab's right-click menu (both modes).

## Background: how Claude Code separates accounts

`claude` reads its whole configuration from `CLAUDE_CONFIG_DIR` (default `~/.claude`, plus
`~/.claude.json` beside it). On macOS the login lives in the Keychain item
`Claude Code-credentials`; with `CLAUDE_CONFIG_DIR` set, the item is
`Claude Code-credentials-<first 8 hex chars of sha256(NFC(CLAUDE_CONFIG_DIR value))>`, so each
folder keeps its own login. Elsewhere, and as a fallback, the login is
`<folder>/.credentials.json`. `cswap run N` (claude-swap 0.26) uses exactly this. The hash scheme
is taken from cswap's `session.py` and must be confirmed against a real login during manual
verification.

## Decisions

| Question | Decision |
| --- | --- |
| Source of accounts | Apiary's own. No dependency on cswap. |
| Busy session when switching | Ask: **Stop and switch**, **Switch when it finishes**, **Don't switch**. |
| Terminal-mode sessions | An **Account ▸** submenu in the tab's right-click menu (also on chat tabs). |
| Usage meter | Follows the focused session's account. |
| Reopening a session | Its account is remembered per session; a fork inherits its parent's. |
| Layout of an account folder | Approach A: a folder linked back to `~/.claude` (below). |

Rejected alternatives:

- **Fully separate account folders.** Transcripts split across several `projects/` folders, and
  moving a session means copying its transcript.
- **Swapping the login just before each launch.** Two sessions starting at once race for one login.

## Part 1: accounts and settings

- **Main account.** `~/.claude` (or `CLAUDE_CONFIG_DIR` if Apiary itself was started with it).
  - Always present and cannot be removed.
  - Its email is read from `oauthAccount.emailAddress` in `~/.claude.json`, so it follows a global
    `cswap switch`.
- **Added accounts.** Each one is a folder `<userData>/accounts/<id>/`, where `<id>` is a slug of
  the label and is unique.
  - The folder is that account's `CLAUDE_CONFIG_DIR`.
  - The account list (id, label) is stored in Apiary's settings.
  - The email is never stored. It is read from `<folder>/.claude.json`.
- **Settings → Accounts.**
  - Lists the accounts. Each row shows "Logged in as x@y" or "Not logged in".
  - A row has **Log in** (opens a terminal session in that account running `claude`, where the user
    types `/login`) and **Remove** (added accounts only).
  - **Add account** asks for a label, creates the folder, then does the same as **Log in**.
  - A **Default account** selector sets the account new sessions start in. The default starts as
    the main account.
- **Removing an account.**
  - Deletes the folder's own entries and its Keychain item.
  - Unlinks links and never follows them.
  - Sessions remembered on that account fall back to the default.

### What an account folder shares with `~/.claude`

Each of these is a symlink to the same path under the main config root:

- `projects/` and `history.jsonl`;
- `settings.json`, `keybindings.json` and `CLAUDE.md`;
- `skills/`, `commands/`, `agents/`, `hooks/` and `plugins/`.

These stay per account:

- the login: the Keychain item and `.credentials.json`;
- `.claude.json`;
- `sessions/`;
- everything else Claude Code creates.

Every transcript lands in `~/.claude/projects`. So the sidebar, Recent, search, forks and the
transcript service need no change.

### Link setup

Links are set up when an account is added and repaired before every launch in that account.

- A missing link is created.
- A wrong link (pointing elsewhere) is replaced.
- A real file or directory at a link's path is renamed to `<name>.apiary-moved-<timestamp>`, never
  deleted.
- A missing link target in `~/.claude` is skipped, except `projects/`, which is created.

### `.claude.json` sync

Before every launch in an added account, Apiary copies two things from the main `.claude.json` into
the account's copy:

- the top-level `mcpServers`;
- each project's trust flag (`projects[<path>].hasTrustDialogAccepted`).

Every other key in the account's file is left alone. The write is atomic: write a temporary file,
then rename it.

## Part 2: switching one session

- **`/` menu (chat).** The first row is `Account: <label> (<email>)`.
  - It matches typed filters (`/acc`).
  - Choosing it opens a list of accounts with a check beside the current one.
- **Tab right-click menu (chat and terminal).** An **Account ▸** submenu with the same list.
- **Switching an idle session.**
  - Chat: end the `claude` process and start it again with `--resume <id>` under the new account.
    The conversation continues in place.
  - Terminal: restart the pty with the resume command under the new account.
- **Switching a busy session.** Busy means a chat turn in progress, or for a terminal, Claude's own
  status other than idle. A prompt says "Claude is still replying." with three buttons:
  - **Stop and switch**: interrupt, then switch.
  - **Switch when it finishes**: switch at the end of the turn. Sending a new message first cancels
    the queued switch.
  - **Don't switch.**
- **A new session that has no transcript yet** switches by starting fresh under the new account.
  There is nothing to resume.
- **Remembered.**
  - Apiary's database maps session id → account id.
  - Reopening a session (Recent, restart, another window) uses its account. A fork inherits its
    parent's.
  - A new session uses the default.
  - An unknown or removed account falls back to the default. The account row then says "was
    <label>, now <default>" once.
- **Shown.**
  - The tab tooltip names the account.
  - With more than one account, the chat status line shows the account's label.
  - With only the main account, nothing on screen changes.

## Part 3: plumbing, usage meter, safety

- **One way to start `claude`.**
  - `accountEnv(account)` returns `{ CLAUDE_CONFIG_DIR: <folder> }` for an added account and `{}`
    for the main account, so the main account behaves exactly as today.
  - Applied where the child environment is built: chat (`spawnLoginShell`), pty (`childEnv`),
    one-shot calls (`claudeOneShot`) and resume commands.
  - Before launch, the links are repaired and `.claude.json` is synced.
  - An architecture test fails if `claude` is started anywhere without going through it.
- **Session tracker.**
  - Watches `<root>/sessions/` for every account, not just `~/.claude/sessions/`.
  - A tab looks up its pid in its own account's folder.
- **Usage meter.**
  - Follows the focused session's account and names it ("work · 5h 42%").
  - Reads the token from the account's Keychain item (macOS), then from
    `<folder>/.credentials.json`. Only `credentials.ts` may name these, which the existing ADR-0019
    rule already requires.
  - The consent prompt names all accounts. Nothing is read before consent.
  - Limits are cached per account.
- **Safety.**
  - Deleting an account never follows a symlink; a test checks that the targets survive.
  - The e2e harness and the packaged smoke test use a throwaway `<userData>`, so a real login is
    never touched.
- **Architecture docs.**
  - A new ADR 0020, "Per-session accounts are linked config folders".
  - `docs/architecture` notes on how a session starts.
  - Each touched folder's `CLAUDE.md` updated.

## Testing

- **Unit:**
  - the Keychain name hash;
  - link setup and repair (missing, wrong, real file moved aside, missing target);
  - `.claude.json` sync (MCP servers, trust flag, other keys untouched, atomic write);
  - the switch decision (idle, busy × three choices, a new session, cancel on send);
  - remembering, inheriting and falling back;
  - `accountEnv`.
- **Integration:** a fake `claude` that prints `CLAUDE_CONFIG_DIR`. It checks chat, pty, one-shot
  and resume all get the right folder.
- **Component and UI review (620px and wide):**
  - Settings → Accounts;
  - the `/` menu row and list;
  - the tab Account submenu;
  - the busy prompt;
  - the status-line label.
- **e2e:**
  1. Add a second account with a faked login.
  2. Start a session on the default.
  3. Switch it.
  4. Check that the same transcript continues and the tab names the new account.
- **Manual:** the user logs in to their real work account, switches a live session, and checks the
  usage meter. This also confirms the Keychain hash scheme.

## Out of scope

- Importing accounts from cswap.
- API-key accounts (`ANTHROPIC_API_KEY`), Bedrock and Vertex.
- Per-folder default accounts (like `cswap map`).
- Remote (Tailscale) clients choosing accounts. A remote client sees the host's sessions with
  their accounts; it gets no switching UI in this version.
