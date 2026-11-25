# Status bar and Claude usage

The bar along the bottom of the window (`status-bar`): plugins' items (`status-item-<plugin>-<id>`),
window buttons, the activity indicator, the residents' badges at the right, and the Claude usage item
(5-hour and weekly limits).

## Sub-features

- Usage asks first: `status-consent-allow` / `status-consent-deny` before reading Claude Code's
  token (ADR-0019). Declining turns the plugin off (`setting-plugin-claude-usage` unchecked);
  switching it back on asks again.
- The usage item is `status-item-claude-usage-usage` (`usage:<id>` per added account; only the
  focused session's account shows), with `status-item-claude-usage-refresh` beside it. Hover shows
  the tooltip (`status-hover`); a click opens the dashboard (`status-panel`, with
  `status-panel-refresh` and `status-panel-settings`).
- When Claude Code writes "You've hit your 5-hour limit · resets …" into a transcript after the last
  fetch, that window shows 100% until its reset, and the hover says so. The usage endpoint turns
  Apiary away (HTTP 429) for long stretches, which marks the item stale (a history icon).
- Size: right-click the bar for Compact / Comfortable / Tall (22 / 34 / 52 px, `context-menu-tall`),
  Reset size, and "Resize by dragging", which shows the handle (`status-bar-resize`, with
  `status-bar-resize-tag`); a double-click on it resets.

## How to get to it (user POV)

The bar shows whenever it has something to show (an item, a pet, activity, a resident, a second
window). Claude usage is on by default and asks for consent the first time; its settings are in
Settings → Plugins (`plugin-claude-usage`).

## Driving it with launchApiary

`launchApiary({ settings: { plugins: { 'claude-usage': true } } })`; click `status-consent-allow`;
proof: the bar shows the usage item (with no real sign-in it says to sign in).
`APIARY_FAKE_USAGE` (set in `process.env` before `launchApiary`) answers for a sign-in already
allowed: no consent prompt, and the item shows its numbers. `drives/features-1-89.verify.ts` uses it,
writes a limit record into a session under `h.projectsRoot`, and proves 80% turns to 100% on
Refresh; then the panel on click, the Tall preset and resize mode.

## Gotchas

- Real usage numbers need a real sign-in and the Keychain: unreachable here.
