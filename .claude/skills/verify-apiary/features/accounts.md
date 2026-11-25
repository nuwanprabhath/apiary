# Claude accounts

Sessions can run under added Claude accounts (linked config folders, ADR-0020). Each session
remembers its account; new sessions start in the default one.

## Sub-features

- Settings → Accounts (`settings-nav-accounts`, `accounts-section`): add (`account-add`,
  `account-name`, `account-add-confirm`, `account-add-cancel`, `account-add-error`), remove with a
  confirm, pick the default (`account-default-select`). Applied at once.
- Switching the account of a session that is mid-reply asks now, later or not
  (`account-switch-now`, `account-switch-later`, `account-switch-none`); an idle one switches at once.
  With more than one account the chat's "/" menu has an Account action, the tab menu an Account
  submenu (`context-menu-account-<id>`), the tab's tooltip says "Account: X", and the status bar has a
  usage meter per account (only the focused session's shows).
- Rename any account (`account-rename-<id>`), log one in (`account-login-<id>`, a login terminal).
  Main has no Remove.

## How to get to it (user POV)

Settings → Accounts.

## Driving it with launchApiary

Open settings (send `apiary:open-settings-dialog`), click `settings-nav-accounts`, then
`account-add`; proof: `account-name` is visible. See the settings test in `drives/features.verify.ts`.

## Gotchas

- The real OAuth step of signing in needs a real `claude`, a browser and the Keychain: unreachable
  here. Adding an account and its login terminal work with a stand-in (`accounts.spec.ts`); an
  email written to the account's `.claude.json` shows within five seconds.
  `accounts.spec.ts` covers the rest with fixture config folders.
