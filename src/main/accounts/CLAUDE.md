# src/main/accounts: Claude accounts

Read with root CLAUDE.md. An account is a config folder Claude Code runs under (`CLAUDE_CONFIG_DIR`).
`main` is the root Apiary already resolves; its `envFor` is `{}`, so it behaves exactly as before.
Added accounts live in the `accounts` folder of userData, one folder per id.

- `accountService.ts`: the list and default (the userData accounts file, a `JsonStore`), `envFor`,
  `configRootFor`, `prepareLaunch` and the session → account lookup (`session_account` table in the
  session database; an unknown or removed id resolves to the default). The email is read from the
  folder's Claude JSON each time and never stored.
- `accountFolder.ts`: `SHARED_ITEMS` are symlinks into the main root (history, settings, skills, …) so
  every account shares sessions and configuration. A real file at a link path is moved aside, never
  deleted. **Removal never follows a symlink**, so the main account's files survive; on macOS it also
  deletes the folder's Keychain item (exit 44, "not found", is success).
- `claudeJsonSync.ts`: copies `mcpServers` and `hasTrustDialogAccepted` from the main Claude JSON
  into an account's, atomically, leaving every other key (its login included).
- `keychainName.ts`: the Keychain item name for a folder (the main name plus the first 8 hex of
  sha256 over the NFC path). It only names the item; reading a token stays behind consent
  (the `credentials-behind-consent` rule lists this file as a home for that reason).

Nothing here launches `claude`: the launchers ask `envFor` and call `prepareLaunch` first.
