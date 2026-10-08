# src/main/statusBar: status-bar plugins

Read with root CLAUDE.md. A status-bar plugin puts an item on the bar along the bottom of the
session area. It is about the whole app, where a session-bar plugin
([`src/main/plugins/CLAUDE.md`](../plugins/CLAUDE.md)) is about one folder and branch. The first
and only built-in is the Claude usage plugin.

## What lives here

- `types.ts`: `StatusBarPlugin` (start, stop, `items()`, `refresh()`, optional `panel()`) and the
  context it is started with (`settings()`, `changed()`).
- `registry.ts`: `StatusBarRegistry`. Registers plugins, starts the enabled ones, routes enable and
  settings changes, answers `items()` and `panel()`.
- `builtin.ts`: `BUILTIN_STATUS_BAR_PLUGINS`, the factories Apiary ships.
- `claudeUsage/`: the usage plugin. `plugin.ts` polls, `limits.ts` reads the 5-hour and 7-day
  limits, `tokens.ts` totals tokens from transcripts, `pricing.ts` estimates cost, `present.ts`
  turns it all into items and panels, `consent.ts` holds the user's answer, `credentials.ts` finds the
  token (behind it).

## The sanctioned way

- **A new status-bar plugin**: write the plugin file implementing `StatusBarPlugin`, add its factory
  to `BUILTIN_STATUS_BAR_PLUGINS`. If it needs something from outside, add it to the factory's deps
  type and to `BuiltinPluginConfig` in `src/main/plugins/pluginService.ts`, which passes it in a loop
  over the list. Do not register by hand.
- **What crosses to the renderer is data**: items, and panels made of typed sections (`heading`,
  `note`, `table`, `gauges`, `stacked-bars`, `line`) from `src/shared/domain/statusBar.ts`. A new
  kind of section is a new variant there plus its drawing in `src/renderer/features/statusBar/`.
  Never send markup.
- **Settings fields** use the existing field kinds, so the Plugins settings section needs no change.
- **Presentation is pure** (`present.ts`) so the wording, colours and tables are tested without a
  clock, network or transcript.
- The renderer reads items through `src/renderer/state/statusBarStore.ts`.

## Tests

- `tests/unit/statusBarRegistry.test.ts`: lifecycle, a throwing plugin, settings routing.
- `tests/unit/claudeUsage.test.ts`: parsing, pricing, presentation.
- `tests/unit/claudeUsageConsent.test.ts`: nothing read before the answer; decline turns the plugin off.
- `tests/component/statusBar.test.tsx`, `tests/e2e/statusBar.spec.ts`.

## Pitfalls

- **`items()` answers from what the plugin already holds.** The bar redraws often; it must never
  wait on the network. The plugin owns its schedule between `start` and `stop`.
- **A plugin that throws contributes nothing and disturbs nothing else.**
- **The usage endpoint is unofficial.** Parse it defensively; a failed fetch keeps the last answer on
  screen, marked stale, and backs off, never beyond fifteen minutes.
- **Polling speeds up at high usage** (`highUsagePollIntervalSeconds` once the 5-hour window reaches
  `highUsageThreshold`); both are settings.
- **Cost is a list-price estimate**, not an invoice, and understated when a model has no known price.
  The dashboard says so.
- **The token is read only after the user said yes, used for one request and never logged**
  (ADR-0019). Until the first answer the plugin shows "Claude usage: allow access?", an item whose
  action is `consent`, and does no Keychain read, no credentials read and no network call. Allow is
  remembered (`claudeUsageConsent` in `settings.json`, main-only: the settings dialog cannot set
  it); Don't allow turns the plugin off, and switching it back on asks again. The prompt text is
  `CONSENT_PROMPT` in `credentials.ts`: change what is read or where it goes, change that text.
- **`Consent` is the gate.** `readAccessToken` and `fetchLimits` take a `Consent`, minted only by
  `ConsentStore.proof()` (`consent.ts`). The Keychain item, the credentials file and the usage
  endpoint are named only in `credentials.ts` and `limits.ts` (`credentials-behind-consent`),
  and nothing casts to `Consent` (`consent-minted-by-store`). A new status-bar plugin that
  needs the user's permission sets `action: { kind: 'consent', prompt }` and implements
  `answerConsent`; the renderer draws the dialog (`features/statusBar/ConsentDialog.tsx`).
- **The Keychain is read only when the config root is the real one**, because a Keychain read can put a
  permission prompt on screen during tests (`readsClaudeKeychain`, `app/config.ts`).
