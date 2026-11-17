# Resident agents (Regent, MR Desk)

Long-running Claude agents that live in the status bar's bottom-right corner, each with a badge
(`resident-badge-<id>`), a popup chat (`resident-popup`) and a right-click menu of quick actions.
Regent finds sessions; MR Desk watches the user's GitLab merge requests through the bundled `mra`.

## Sub-features

- Badge states: working (`resident-working`, the `doing` text as its tooltip), unread
  (`resident-unread`), a count (`resident-count`), setup needed (`resident-setup`, `resident-setup-open`).
- Popup: ask in the textbox; Regent answers with session chips (`resident-session-chip`) that open
  the session; permission prompts (`resident-permission-allow`/`-deny`); stop, restart, close and
  resize handles (`resident-popup-*`).
- Quick actions from the badge menu (`resident-action`). An action declares `opensPopup`; MR Desk's
  "Check my MRs now" runs without opening the popup, the badge shows it working.
- Settings: Residents section (`residents-section`), saved at once.

## How to get to it (user POV)

Settings → Residents to enable one; then its badge appears in the status bar. Click it for the
popup; right-click for the quick actions.

## Driving it with launchApiary

The resident's `claude` is the stand-in `tests/fixtures/fake-claude-resident.mjs`, wrapped in an
executable `claude` script passed as `claudeBin`, with the resident enabled in `settings.residents`.
See the "regent popup over MCP" test in `drives/features.verify.ts`. Proof: the popup's chip names
the session matching what was asked.

## Gotchas

- MR Desk against real GitLab needs a real `glab` and the network: unreachable here.
  `residents.spec.ts` drives it with `tests/fixtures/bin/fake-glab*.sh` and python3.
- e2e specs this mirrors: `residents.spec.ts`, `regent.spec.ts`.
