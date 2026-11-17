# Claude accounts

Sessions can run under added Claude accounts (linked config folders, ADR-0020). Each session
remembers its account; new sessions start in the default one.

## Sub-features

- Settings → Accounts (`settings-nav-accounts`, `accounts-section`): add (`account-add`,
  `account-name`, `account-add-confirm`, `account-add-cancel`, `account-add-error`), remove with a
  confirm, pick the default (`account-default-select`). Applied at once.
- Switching a running session's account asks now, later or not (`account-switch-now`,
  `account-switch-later`, `account-switch-none`). The chat's "/" menu has an account action.

## How to get to it (user POV)

Settings → Accounts.

## Driving it with launchApiary

Open settings (send `apiary:open-settings-dialog`), click `settings-nav-accounts`, then
`account-add`; proof: `account-name` is visible. See the settings test in `drives/features.verify.ts`.

## Gotchas

- Signing an account in needs a real `claude`, a browser and the Keychain: unreachable here.
  `accounts.spec.ts` covers the rest with fixture config folders.
