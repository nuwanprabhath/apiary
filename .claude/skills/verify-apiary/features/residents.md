# Resident agents (Regent, MR Desk)

Long-running Claude agents that live in the status bar's bottom-right corner, each with a badge
(`resident-badge-<id>`), a popup chat (`resident-popup`) and a right-click menu of quick actions.
Regent finds sessions (and takes instructions over Slack, see [slack.md](slack.md)); MR Desk watches
the user's GitLab merge requests through the bundled `mra`.

## Sub-features

- Badge states are `data-state` on the badge (`asleep`, `idle`, `working`) plus `data-needs` and
  `data-pending`. Working shows the activity in the `.resident-activity` pill and the aria-label.
  An unread reply is `resident-unread`; `resident-count` is how many things need you (attention
  or permission requests), and replaces the unread dot. MR Desk's honey pot shows unpublished
  drafts as `resident-pending` at the orb's foot.
- Hover or focus a badge for its card, `resident-hover-<id>`, with rows `resident-hover-now`,
  `-needs`, `-to-finish` (MR Desk's drafts), `-checks`, `-digest`, `-setup`.
- Popup: ask in the textbox; Regent answers with session chips (`resident-session-chip`) that open
  the session, and instant matches under your message (`resident-hit`). Permission prompts
  (`resident-permission-allow`/`-deny`); stop, restart (asks while working), clear, close and resize
  (`resident-popup-*`). Every message has its time (`message-time`): above yours and above a quick
  action's chip (`resident-action`), on the first line of a reply. A message from Slack is labelled
  `resident-via`; a note from Apiary is a `resident-note` chip.
- An MR Desk with no project shows `resident-setup` (with `resident-setup-open`) as a banner in its
  popup, and a "Setup" row in its card.
- The badge's right-click menu, `resident-menu`: "Open chat", the kind's quick actions, "Turn off" or
  "Turn on", "Settings…". Its items have no test ids: `getByRole('menuitem', { name })`. An action
  declares `opensPopup`; MR Desk's "Check my MRs now" runs without opening the popup, the badge
  shows it working. MR Desk's own-MR alerts are its cycle raising attention (`resident-count`).
- Settings: Residents section (`residents-section`), saved at once; add one with
  `resident-add-<kind>`, each then a `resident-card-<id>`.

## How to get to it (user POV)

Settings → Residents → Add Regent / Add MR Desk. Its badge appears in the status bar at once, asleep
until turned on (a badge shows for every configured resident, on or off). Click it for the popup;
right-click for the menu.

## Driving it with launchApiary

The resident's `claude` is the stand-in `tests/fixtures/fake-claude-resident.mjs`, wrapped in an
executable `claude` script passed as `claudeBin`, with the resident enabled in `settings.residents`.
See the "regent popup over MCP" test in `drives/features.verify.ts`. Proof: the popup's chip names
the session matching what was asked. `drives/features-1-89.verify.ts` adds both kinds from Settings,
reads the menu, opens MR Desk's setup banner and reads the message times.

## Gotchas

- MR Desk against real GitLab needs a real `glab` and the network: unreachable here.
  `residents.spec.ts` drives it with `tests/fixtures/bin/fake-glab*.sh` and python3, and so do its
  count, the desk and the `resident-pending` drafts.
- e2e specs this mirrors: `residents.spec.ts`, `regent.spec.ts`.
