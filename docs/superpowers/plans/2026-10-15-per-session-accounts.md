# Per-session Claude accounts: implementation plan

> **For agentic workers:** you are running non-interactively. Never ask a question; every decision
> that needs judgment is made below under "Decisions already made". Steps use checkbox (`- [ ]`)
> syntax. Spec: `docs/superpowers/specs/2026-10-15-per-session-accounts-design.md` (read it first).

**Goal:** each Apiary session runs under a Claude account the user picks. New sessions use a default
account from Settings; any session can move to another account from the `/` menu or the tab menu.

**Architecture:** an added account is a folder `<userData>/accounts/<id>/` used as that session's
`CLAUDE_CONFIG_DIR`. It is symlinked back to the main config root for transcripts, history,
settings, skills, commands, agents, hooks and plugins, so every transcript still lands in
`~/.claude/projects`. One function, `accountEnv`, gives every `claude` start its environment.
`AccountService` (main) owns the list. A SQLite table maps session id to account id.

**Tech stack:** Electron 44, React 19, strict TypeScript, better-sqlite3, vitest, Playwright.

## Global constraints

- Release version **1.43.0**, one `CHANGELOG.md` section `## [1.43.0]`, bumped once by the lead on
  `release/1.43.0`. Agents do not bump the version.
- Never add AI attribution to a commit. Never push, tag, stash or use `--no-verify`.
- Every rule in the root `CLAUDE.md` "Rules and what enforces them" applies. In particular:
  - processes only via `main/exec`;
  - persisted JSON only via `JsonStore`;
  - IPC only via `npm run new -- ipc <name>`;
  - files ≤400 lines and functions ≤120 lines;
  - no allowlist or baseline growth.
- The main account is the config root Apiary already resolves (`resolveConfigRoot`). For it,
  `accountEnv` returns `{}`, so its behaviour is byte-for-byte today's.
- The main account's id is the literal string `'main'`.
- Account folders live under `<userData>/accounts/`. Tests and e2e use a throwaway userData.
- Removing an account never follows a symlink.
- The macOS Keychain item for an account folder is named
  `Claude Code-credentials-<sha256(NFC(folderPath)).hex.slice(0, 8)>`. The main account keeps the
  item `Claude Code-credentials`.
- The links an account folder shares with the main root (`SHARED_ITEMS`):
  - `projects`, `history.jsonl`;
  - `settings.json`, `keybindings.json`, `CLAUDE.md`;
  - `skills`, `commands`, `agents`, `hooks`, `plugins`.

## Decisions already made (do not ask)

1. **Account list.** `<userData>/accounts.json` through a `JsonStore<AccountsFile>`:
   `{ version: 1, accounts: [{ id, label }], defaultId }`. `id` is
   `slug(label)` (lowercase, `[a-z0-9-]`, at most 32 characters), with `-2`, `-3`, … appended until
   it is unique. `'main'` is reserved. Add `accounts.json` to `persistedStores.test.ts`.
2. **The email is read, never stored.**
   - Main account: `oauthAccount.emailAddress` from `<home>/.claude.json`, or from
     `<configRoot>/.claude.json` when the root is a `CLAUDE_CONFIG_DIR`.
   - Added account: `<folder>/.claude.json`.
   - A missing or unreadable file means `email: null`, shown as "Not logged in".
3. **Session → account.** A new SQLite table, created idempotently in `sessionStore.ts`:
   `session_account(session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL)`.
   - No foreign key, because a new session is not yet in `session`.
   - Unknown or removed ids resolve to the default account.
4. **Pending sessions.**
   - A pty or chat started for a session that has no id yet records the account on its spawn
     record.
   - When the tracker (pty) or the chat's "moved to a new session" callback resolves the real id,
     the service writes `session_account`.
   - A fork writes its parent's account for the child id when the child id resolves.
5. **Switching runs in main and is immediate.** `sessionAccountSwitch(sessionId, accountId)`:
   - stores the account;
   - if a chat is running for the id: `chats.stop(id)`, then `chats.start(id, cwd, sameOpts)` under
     the new env;
   - if a TUI pty is running for the id: kill it and respawn the resume command under the new env,
     on the same pty id, so attached windows keep their tab;
   - if neither is running: only stores the account.
6. **The busy prompt and waiting live in the renderer.**
   - The renderer decides busy from the chat state's turn status, or for a pty from
     `PtySessionInfo.status === 'busy'`.
   - **Stop and switch:** call `sessionAccountSwitch` straight away. Stopping the process ends the
     turn.
   - **Switch when it finishes:** a store in `state/` watches for idle, then calls it. Sending a
     message in that session first cancels the wait.
   - **Don't switch:** does nothing.
7. **Usage meter.** The plugin emits one item per logged-in account, with id `usage:<accountId>`;
   `usage` stays the id for `'main'` so existing tests hold.
   - The renderer's status bar shows only the item for the focused session's account, falling back
     to the default account when nothing is focused.
   - With one account, nothing changes.
   - Consent stays one answer for all accounts, and the prompt text names them.
8. **Settings.**
   - A new section "Accounts" in `features/settings/sections/`.
   - Data comes over IPC from `AccountService`, not from the `SETTINGS` schema, because the list
     needs main to create folders.
   - The default account is part of `accounts.json`, also not a `SETTINGS` entry.
9. **Logging in.** `accountsLogin(accountId)` opens a new terminal session in that account running
   plain `claude`, with the same mechanism as "New session". The user types `/login`. When the tab
   exits or the `.claude.json` changes, the `accountsChanged` event re-reads the emails.
   `accountsAdd` returns the new id; the renderer then calls `accountsLogin`.

## File structure

| File | Responsibility |
| --- | --- |
| `src/shared/domain/accounts.ts` (new) | `AccountId` (branded), `AccountInfo { id, label, email, isMain, folder: null for main }`, `AccountsState { accounts, defaultId }`, `MAIN_ACCOUNT_ID`, `accountSlug`, guards |
| `src/main/accounts/accountFolder.ts` (new) | pure-ish fs: `ensureAccountLinks(folder, mainRoot)`, `removeAccountFolder(folder)`, `SHARED_ITEMS` |
| `src/main/accounts/claudeJsonSync.ts` (new) | `syncClaudeJson(mainClaudeJson, accountClaudeJson)`: copies `mcpServers` and the trust flags; atomic |
| `src/main/accounts/keychainName.ts` (new) | `keychainServiceFor(folder: string \| null): string` |
| `src/main/accounts/accountService.ts` (new) | list, add, remove, setDefault, `envFor(accountId)`, `configRootFor(accountId)`, `accountOf(sessionId)`, `setAccountOf`, `prepareLaunch(accountId)` (links + sync), change listeners |
| `src/main/accounts/CLAUDE.md` (new) | the folder's map and rules |
| `src/main/store/sessionStore.ts` | `session_account` table plus `getSessionAccount` / `setSessionAccount` |
| `src/main/terminals/terminalService.ts`, `src/main/chat/chatManager.ts`, `src/main/chat/chatService.ts`, `src/main/claude/claudeOneShot.ts` | pass `accountEnv` |
| `src/main/claude/claudeSessionTracker.ts`, `src/main/app/container.ts` | read `<account root>/sessions` per pty |
| `src/main/statusBar/claudeUsage/*` | per-account items, Keychain name per account |
| `src/shared/ipc/contract.ts` + handlers + fake + clauses | `accountsList`, `accountsAdd`, `accountsRemove`, `accountsSetDefault`, `accountsLogin`, `accountsChanged` (event), `sessionAccountGet`, `sessionAccountSwitch`, `sessionAccountsChanged` (event) |
| `src/renderer/state/accountsStore.ts` (new) | `createIpcStore` over `accountsList` and `accountsChanged`; the session → account map |
| `src/renderer/state/accountSwitch.ts` (new) | the switch command, including "switch when it finishes" and cancel-on-send |
| `src/renderer/features/settings/sections/AccountsSection.tsx` (new) | the Settings UI |
| `src/renderer/features/chat/CommandPalette.tsx` + `paletteActions.ts` | the Account row and account list |
| `src/renderer/features/pane/TabContextMenu.tsx` | the Account ▸ submenu |
| `src/renderer/features/chat/AccountSwitchPrompt.tsx` (new) | the three-button busy prompt (a `Modal` from `ui/`) |
| `src/renderer/features/chat/ChatStatus.tsx`, `SessionTab.tsx` | the label and the tooltip |
| `docs/adr/0020-per-session-accounts-are-linked-config-folders.md` (new) | the decision, the rejected alternatives, the check |

## Work packages and waves (≤6 agents at once)

- **Wave 1:** WP-A1 (Sonnet).
- **Wave 2:** WP-A2 (Sonnet).
- **Wave 3 (parallel):** WP-B, WP-D and WP-E (Sonnet).
- **Wave 4:** WP-F, done by the lead: e2e, docs, version, changelog, README.

Each wave branches from `release/1.43.0` after the previous wave has merged.

---

### Task A1: accounts core (main, shared, IPC)

**Files:** create the shared domain, `accountFolder.ts`, `claudeJsonSync.ts`, `keychainName.ts`,
`accountService.ts` and `src/main/accounts/CLAUDE.md`. Modify `sessionStore.ts` and `container.ts`
(build `AccountService`; add it to the `construct-in-container` allow list). Add the IPC channels
`accountsList`, `accountsAdd`, `accountsRemove`, `accountsSetDefault`, `accountsChanged` and
`sessionAccountGet`, each with its handler, fake and clause. Add tests.

**Produces (exact):**

```ts
// shared/domain/accounts.ts
export type AccountId = Brand<string, 'AccountId'>   // use the existing Brand helper in shared/domain/ids.ts
export const MAIN_ACCOUNT_ID = 'main' as AccountId
export interface AccountInfo { id: AccountId; label: string; email: string | null; isMain: boolean }
export interface AccountsState { accounts: AccountInfo[]; defaultId: AccountId }
export function accountSlug(label: string, taken: ReadonlySet<string>): string
// main/accounts/accountService.ts
class AccountService {
  list(): AccountsState
  add(label: string): AccountId                  // creates folder + links
  remove(id: AccountId): void                    // refuses MAIN_ACCOUNT_ID
  setDefault(id: AccountId): void
  defaultId(): AccountId
  resolve(id: AccountId | null | undefined): AccountId   // unknown/removed → default
  configRootFor(id: AccountId): string           // main → mainRoot
  envFor(id: AccountId): Record<string, string>  // main → {}; else { CLAUDE_CONFIG_DIR: folder }
  prepareLaunch(id: AccountId): void             // ensureAccountLinks + syncClaudeJson; no-op for main
  accountOf(sessionId: SessionId): AccountId     // resolve(stored)
  setAccountOf(sessionId: SessionId, id: AccountId): void
  onChanged(fn: () => void): () => void
}
```

- [ ] **Step 1: write the failing tests** in `tests/unit/accounts/`:
  - `accountFolder.test.ts`, with these cases:
    - "creates every shared link pointing at the main root";
    - "replaces a link pointing elsewhere";
    - "moves a real file at a link path aside as .apiary-moved-<ts>";
    - "skips a missing target except projects, which it creates";
    - "remove deletes the folder but never the link targets".
  - `claudeJsonSync.test.ts`, with these cases:
    - "copies mcpServers";
    - "copies hasTrustDialogAccepted per project without touching other project keys";
    - "leaves every other key";
    - "creates the account file when missing";
    - "writes atomically (temp + rename)".
  - `keychainName.test.ts`, with these cases:
    - "main is 'Claude Code-credentials'";
    - "folder is sha256 of the NFC path, first 8 hex". Fixed vector: compute it in the test with
      `createHash` over `'/tmp/a'.normalize('NFC')`.
  - `accountService.test.ts`, with these cases:
    - "slug is unique and never 'main'";
    - "remove refuses main";
    - "removing the default resets default to main";
    - "envFor main is empty";
    - "resolve maps an unknown id to the default";
    - "accountOf falls back after removal";
    - "email is read from .claude.json oauthAccount.emailAddress";
    - "a corrupt .claude.json gives email null".
  - `tests/integration/sessionStore.test.ts`: add "session_account survives reopening the
    database".
- [ ] **Step 2:** run `npm test -- tests/unit/accounts`. Expect FAIL, because the modules do not
  exist.
- [ ] **Step 3: implement.** Core of the link logic:

  ```ts
  export const SHARED_ITEMS = ['projects', 'history.jsonl', 'settings.json', 'keybindings.json', 'CLAUDE.md',
    'skills', 'commands', 'agents', 'hooks', 'plugins'] as const
  export function ensureAccountLinks(folder: string, mainRoot: string, now = Date.now()): void {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    for (const name of SHARED_ITEMS) {
      const target = join(mainRoot, name)
      const at = join(folder, name)
      if (!existsSync(target)) { if (name !== 'projects') continue; mkdirSync(target, { recursive: true }) }
      const st = lstatSafe(at)
      if (st?.isSymbolicLink()) { if (readlinkSync(at) === target) continue; unlinkSync(at) }
      else if (st !== null) renameSync(at, `${at}.apiary-moved-${String(now)}`)
      symlinkSync(target, at)
    }
  }
  ```

  - `removeAccountFolder` walks the folder with `lstat`, unlinks symlinks and recurses only into
    real directories. It also deletes the account's Keychain item on darwin: run
    `security delete-generic-password -s <name>` through `createExec`, ignoring "not found".
    Unit tests inject the exec.
  - Writes to `accounts.json` go through `JsonStore`, and the folder writes through `main/fs`
    helpers. If `no-raw-state-write` fires on the symlink calls, add the account folder to that
    rule's sanctioned home with a reason and a `sanctionedRules` case.
- [ ] **Step 4: add the IPC channels.** Run `npm run new -- ipc <name>` for each channel, then fill
  in:
  - Guards: `accountsAdd(label: string ≤ 40 chars, non-blank)`, `accountsRemove(id)`,
    `accountsSetDefault(id)`, `sessionAccountGet(sessionId) → AccountId`.
  - `accountsChanged` is an event that carries `AccountsState`.
  - Remote scope: `accountsList` and `sessionAccountGet` are `remote`; the rest are `local`.
  - The fake keeps an in-memory list.
- [ ] **Step 5:** run `npm run typecheck && npm run lint && npm test`. Expect PASS.
- [ ] **Step 6: commit:** `feat(accounts): accounts core: folders linked to the main config, the
  account list, session accounts`.

### Task A2: launching under an account, tracking, switching (main)

**Consumes:** `AccountService` from A1.
**Produces:** IPC `accountsLogin(accountId) → NewSessionInfo`,
`sessionAccountSwitch(sessionId, accountId) → void`, and the event
`sessionAccountsChanged(Record<SessionId, AccountId>)`.

- [ ] **Step 1: write the failing tests.**
  - `tests/integration/accountLaunch.test.ts` uses a fixture `claude` (`tests/fixtures/bin`) that
    prints `CLAUDE_CONFIG_DIR` (or `<unset>`) to a file named by an env var. Cases:
    - "a resumed terminal in an added account gets its folder";
    - "the main account leaves CLAUDE_CONFIG_DIR unset";
    - "a chat start gets the session's account";
    - "a one-shot call gets the default account";
    - "a fork starts in its parent's account";
    - "a new session starts in the default account".
  - `tests/unit/claudeSessionTracker.test.ts`: add "reads each pty's pid file from its own
    account's sessions folder".
  - `tests/unit/chatService.test.ts`: add these cases:
    - "switching a running chat stops it and starts it with the new env";
    - "switching an idle session with no process only stores it".
  - `tests/unit/terminalService.test.ts` (create if missing): add "switching a running terminal
    respawns the resume command on the same pty id with the new env".
  - An architecture test, `tests/unit/architecture/claudeStartsWithAccount.test.ts`: every call to
    `buildResumeCommand`, `buildNewSessionCommand` or `buildChatCommand`, and every
    `spawnLoginShell` in `main/claude`, sits in a function that also passes `envFor(` or
    `extraEnv`. Scan the source text the way the other architecture tests do. Prove that it fires by
    removing one `env:` in a scratch copy.
- [ ] **Step 2:** run them. Expect FAIL.
- [ ] **Step 3: implement.**
  - `TerminalService` gets an `accounts: AccountService` dependency. `this.env()` becomes
    `this.env(accountId)`, which merges `accounts.envFor(id)` after
    `accounts.prepareLaunch(id)`.
  - `PtyManager`'s spawn record keeps `accountId`. `tuiPids()` becomes `tuiProcesses()`, returning
    `Map<ptyId, { pid, sessionsDir }>`, and the tracker reads `sessionsDir` per pty.
  - `ChatManager.start` takes `env` and passes `extraEnv` to `spawnLoginShell`. Its moved-session
    callback calls `accounts.setAccountOf(to, accountOf(from))`.
  - `claudeOneShot` takes `env` from `accounts.envFor(accounts.defaultId())`.
  - When the tracker resolves a pending pty's session id, call `setAccountOf`, in the place the
    tracker's `onChange` is wired.
  - For `sessionAccountSwitch`, follow decision 5. Afterwards broadcast `sessionAccountsChanged`
    with the full map for live sessions.
  - `accountsLogin` runs `startNewSession` with the account.
- [ ] **Step 4:** run `npm run typecheck && npm run lint && npm test`. Expect PASS.
- [ ] **Step 5: commit:** `feat(accounts): sessions start, resume, fork and switch under their
  account`.

### Task B: Settings → Accounts (renderer)

**Consumes:** `accountsList`, `accountsAdd`, `accountsRemove`, `accountsSetDefault`,
`accountsLogin` and the `accountsChanged` event.

**Design (build exactly this):**

- A section titled "Accounts", placed after "General". It starts with one line of help text:
  "Run a session as another Claude account without signing out of this one. New sessions start in
  the default account."
- **The account rows.** One row per account:
  - the label in bold;
  - below it, muted: "<you@example.com>", or "Not logged in", or "This Mac's Claude login" for main;
  - on the right: **Log in** (`.btn quiet`), plus **Remove** (`.btn quiet danger`) for added
    accounts.
  - **Remove** asks first ("Remove the account 'work'? Its login is deleted from this Mac. Its
    conversations stay.").
- **Default account.** Below the rows, a `select` labelled "Default account".
- **Adding an account.** An **Add account…** button opens an inline label field with
  **Add** and **Cancel** buttons. **Add** is disabled while the field is blank. Adding calls
  `accountsAdd` and then `accountsLogin`.
- **Store.** `state/accountsStore.ts`, built with `createIpcStore`.

- [ ] **Step 1:** write `tests/component/settingsAccounts.test.tsx`. Cases:
  - "lists main with its email";
  - "add creates an account and opens its login";
  - "remove asks and removes";
  - "default select changes the default";
  - "main has no Remove".
- [ ] **Step 2:** run it. Expect FAIL.
- [ ] **Step 3:** implement, then add the UI scenario `tests/component/ui/settingsAccounts.ui.tsx`
  with these states: one account, three accounts with one logged out, and the add field open. It
  runs at 620 and 1000 widths.
- [ ] **Step 4:** run `npm run test:component -- tests/component/settingsAccounts.test.tsx` and
  `npm run ui:review`. Look at every screenshot.
- [ ] **Step 5: commit:** `feat(accounts): Settings → Accounts`.

### Task D: usage meter per account

**Consumes:** `AccountService.list()` and `configRootFor()`, `keychainServiceFor()`, and the
session → account map.

- [ ] **Step 1: write the failing tests.**
  - `tests/unit/claudeUsage*.test.ts`. Cases:
    - "polls every logged-in account and emits usage:<id> items";
    - "main keeps the id usage";
    - "reads an added account's token from its own Keychain name, then its .credentials.json";
    - "nothing is read before consent, for any account";
    - "limits are cached per account".
  - Component test `tests/component/statusBarAccounts.test.tsx`. Cases:
    - "shows only the focused session's account item, and its label";
    - "falls back to the default account with no focus";
    - "one account looks exactly as before".
- [ ] **Step 2:** run them. Expect FAIL.
- [ ] **Step 3: implement.**
  - `readMacKeychain` takes the service name.
  - `useKeychain` stays false under a test root.
  - The text with more than one account is `"<label> · " + statusText`.
  - `CONSENT_PROMPT` mentions "each of your Claude accounts".
  - Extend the UI scenario for the status bar with two accounts.
- [ ] **Step 4:** run typecheck, lint, the tests and `ui:review`.
- [ ] **Step 5: commit:** `feat(accounts): the usage meter follows the focused session's account`.

### Task E: switching UI (renderer)

**Consumes:** `sessionAccountGet`, `sessionAccountSwitch`, the `sessionAccountsChanged` event, and
`accountsStore`.

**Design (build exactly this):**

- **`/` menu Account row.** The first row of the Actions group, offered only when there is more than
  one account. Its label is `Account: <label>` and its description is the email, or "Not logged
  in".
  - It matches the query `acc`, `account`, the label or the email.
  - Choosing it replaces the list with the accounts. The current account has a check. **Esc** or
    **←** goes back.
  - Choosing the current account closes the menu.
- **Tab menu.** In `TabContextMenu`, an `Account` item with a `submenu` of accounts (`checked` on
  the current one), placed after "Fork session". It is offered only when there is more than one
  account and the tab is a Claude session, not a shell.
- **Busy prompt.** `AccountSwitchPrompt` is a `Modal` titled "Claude is still replying". Body text:
  "Switching to <label> restarts this session. What should happen to the current reply?"
  - Buttons, in order: **Stop and switch** (primary), **Switch when it finishes**, **Don't
    switch**. **Esc** means Don't switch.
- **Waiting to switch.** `state/accountSwitch.ts` holds `pending: Map<SessionId, AccountId>`.
  - On idle, it calls the switch and clears the entry.
  - `chatSend` for that session clears the entry first.
  - While a switch is pending, the chat status line shows "Switching to <label> after this reply".
- **Labels.**
  - The tab tooltip is `"<title>\nAccount: <label>"`, only when there is more than one account.
  - With more than one account, `ChatStatus` shows a small muted pill with the label, using the
    existing tokens.

- [ ] **Step 1: write the failing tests:**
  - `tests/component/accountSwitch.test.tsx`. Cases:
    - "no account row with one account";
    - "the / menu lists accounts with the current one checked";
    - "picking another account on an idle chat switches at once";
    - "a busy chat asks; Stop and switch switches";
    - "Switch when it finishes waits for idle";
    - "sending a message cancels a waiting switch";
    - "Don't switch does nothing";
    - "the tab menu Account submenu switches a terminal session";
    - "the tooltip names the account".
  - `tests/unit/accountSwitch.test.ts`: the pending-switch state machine.
- [ ] **Step 2:** run them. Expect FAIL.
- [ ] **Step 3:** implement. Add UI scenarios with these states:
  - the menu row;
  - the account list;
  - the tab submenu;
  - the busy prompt;
  - the status pill;
  - the "Switching after this reply" line.

  Each runs at 620 and 1000 widths.
- [ ] **Step 4:** run typecheck, lint, the component tests and `ui:review`. Look at every
  screenshot.
- [ ] **Step 5: commit:** `feat(accounts): switch a session's account from the / menu or its tab`.

### Task F (lead): e2e, docs, release prep

- [ ] Write `tests/e2e/accounts.spec.ts`. It uses the harness's fake claude and throwaway userData,
  and a faked login (it writes `<folder>/.claude.json` with an `oauthAccount`):
  1. Add an account.
  2. Start a session on main.
  3. Switch it.
  4. Check that the same transcript continues, `CLAUDE_CONFIG_DIR` reached the restarted process,
     and the tooltip names the account.
- [ ] Write ADR 0020. Update `docs/architecture/chat.md` (how a session starts),
  `docs/environment.md` (`accounts.json`, `accounts/`), `src/main/CLAUDE.md`, and the root
  `CLAUDE.md` map row and rules row (from the A2 architecture test).
- [ ] Run `npm version 1.43.0 --no-git-tag-version`, add the CHANGELOG section, and update the
  README feature list.
- [ ] Run the full `npm run test:e2e` and `npm run ui:review`.
- [ ] Manual check with the maintainer's real work account:
  - log in;
  - confirm the Keychain item name;
  - switch a live session;
  - check the usage meter.
- [ ] Ask the maintainer before pushing or tagging.

## Self-review

- **Spec coverage:**
  - Part 1 (A1, B); links and sync (A1).
  - Part 2: switching (A2, E), remembering and fork (A2), shown (E).
  - Part 3: plumbing (A2), tracker (A2), meter (D), safety (A1 tests, F), docs (F).
  - Testing (every task, F).
  - Out of scope: untouched.
- **Names used across tasks:** `AccountService`, `envFor`, `prepareLaunch`, `accountOf`,
  `setAccountOf`, `MAIN_ACCOUNT_ID`, `keychainServiceFor`, `sessionAccountSwitch` and
  `accountsChanged` are the same in every task.
