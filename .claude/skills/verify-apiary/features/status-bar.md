# Status bar and Claude usage

The bar along the bottom of the window (`status-bar`): plugins' items, the residents' badges at the
right, and the Claude usage item (5-hour and weekly limits).

## Sub-features

- Usage asks first: `status-consent-allow` / `status-consent-deny` before reading Claude Code's
  token (ADR-0019). Hover for the panel (`status-hover`, `status-panel-refresh`, `status-panel-settings`).
- The bar's height can be dragged (`status-bar-resize`).

## How to get to it (user POV)

Always visible; turn items on in Settings → Plugins.

## Driving it with launchApiary

`launchApiary({ settings: { plugins: { 'claude-usage': true } } })`; click `status-consent-allow`;
proof: the bar shows the usage item (with no real sign-in it says to sign in).
`APIARY_FAKE_USAGE` gives it numbers without a token.

## Gotchas

- Real usage numbers need a real sign-in and the Keychain: unreachable here.
