# ADR-0020: A session's Claude account is a config folder linked back to the main one

- **Status:** Accepted
- **Context:** The maintainer has two Claude accounts (personal and work) and used `cswap` to swap
  between them. `cswap` swaps the login for the whole machine, so every terminal, every Apiary
  session and the VS Code extension move at once. The request was a default account for new
  sessions, and the choice to move one session to another account from its `/` menu.
- **Decision:**
  - **What an account is.** Claude Code reads everything from `CLAUDE_CONFIG_DIR`. On macOS it
    names its Keychain login after that folder, so an added account is a folder
    `<userData>/accounts/<id>/` that becomes the `CLAUDE_CONFIG_DIR` of the sessions running under
    it. This is the mechanism `cswap run` uses for one terminal.
  - **What the folder shares.** It symlinks back to the main config root for `projects/` (the
    transcripts), `history.jsonl`, the settings, skills, commands, agents, hooks and plugins. So
    every transcript lands in one place, and the sidebar, search, Recent and forks need no change.
  - **What stays per account.** The login, .claude.json and `sessions/`. Before each launch the
    MCP servers and the per-project trust flags are copied in from the main .claude.json.
  - **The main account.** It is the config root Apiary already used, and adds no environment at
    all.
  - **One way to start `claude`.** Every start (terminal, chat, fork, new session, one-shot) gets
    its environment from `AccountService.launchEnv(account)`.
  - **Remembering.** A session's account is stored in `session_account`. Switching restarts the
    session's `claude` with `--resume <same id>` under the new folder.
- **Alternatives tried:**
  - **Fully separate account folders** (no shared `projects/`). Each conversation would live
    under one account, Apiary would have to scan several roots, and moving a session to another
    account would mean copying its transcript.
  - **Swapping the login just before each launch**, as `cswap switch` does. Two sessions starting
    at once race for the one login.
  - **Reusing cswap's stored accounts.** This couples Apiary to another tool's internal file
    layout. Not chosen.
- **Consequences:**
  - A `/login` typed in an account's terminal is noticed from the file Claude rewrites
    (`checkLogins`, every 5 s, re-reading only a file whose stamp moved).
  - Removing an account is refused while a session runs under it. It unlinks links and never
    follows them, and it deletes the account's Keychain item.
  - The usage meter polls each logged-in account behind the same single consent (ADR-0019) and
    shows the focused session's account.
  - The Keychain item's name, `Claude Code-credentials-<sha256(folder)[:8]>`, is Claude Code's
    internal scheme (as used by `cswap`). If Claude changes it, the meter shows "sign in" for added
    accounts until `keychainName.ts` follows. The sessions themselves are unaffected, because
    `claude` finds its own login.
- **Enforced by:**
  - `tests/unit/architecture/claudeStartsWithAccount.test.ts`: a `claude` start without the
    account's env fails.
  - `tests/unit/accounts/` covers:
    - links and their repair, including that a removed account never touches the link targets;
    - an id from a hand-edited accounts.json can never name a folder outside `accounts/`;
    - the .claude.json sync;
    - the login checks.
  - `tests/integration/accountLaunch.test.ts`: each start path gets the right folder.
  - `tests/e2e/accounts.spec.ts`: add an account, switch a live chat, and it resumes under the
    account's folder.

See [`src/main/accounts/CLAUDE.md`](../../src/main/accounts/CLAUDE.md) and the design in
`docs/superpowers/specs/2026-10-15-per-session-accounts-design.md`.
