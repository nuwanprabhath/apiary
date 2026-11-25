# src/main/privacy: strict mode, retention, purge and export

Read with root CLAUDE.md. Spec: `docs/reviews/gdpr-compliance-review.md` §3.

- `privacyGate.ts`: the one question every background feature asks before sending data off the machine.
- `retentionSweeper.ts`: enforces `dataRetentionDays` (and 24 hours for Slack awaiting) at start
  after 60 s, then every 24 h, strict mode or not. Each step is isolated; only counts are logged.
- `purgeService.ts`: `PurgeRequest` item by item, each failure in `PurgeResult.failed`, bytes measured
  before and after.
- `exportService.ts`: `apiary-export-<date>/` in a folder main's dialog picked; files 0600, folders 0700, no token.
- Wiring: `app/privacyContainer.ts` (gate, service) and `app/privacyTargetsContainer.ts` (builds the
  three above over the container's stores and hands them to `privacy.attach`); `index.ts` starts
  the sweeper with `privacy.startSweeper()`.

## Never touch the Claude config root

Nothing here deletes or rewrites anything under `~/.claude` or `CLAUDE_CONFIG_DIR`: those are the
user's transcripts, Claude Code's, not Apiary's. Every purge target is checked with
`realPathInside(userData, path)` and refused when it leads outside (a symlink included);
`tests/unit/privacy/purgeService.test.ts` plants a sentinel under a fake config root and checks it survives.

## A new store

A new userData store that holds personal data joins both:

- **the sweeper**: a step in `SWEEP_STEPS` and `steps()` with an injected port (`pruneOlderThan`-style,
  returning a count), wired in `privacyTargetsContainer.ts`;
- **the purge**: a key in `PurgeRequest` (`shared/domain/privacy.ts`), and its `PurgeTarget` (the
  paths it empties, and the owning store's own clear) in `privacyTargetsContainer.ts`;
- and the export, when the person would want a copy of it.

## Known gaps

- Slack `awaiting` lives in `slack/slackStore.ts`; the sweeper's step is `skipped` (the bridge
  drops entries older than a day on each poll).

## Residents

- History is pruned through `ResidentService.pruneHistoryOlderThan`, which prunes the running chat's
  in-memory copy and saves it, so the next write cannot bring an entry back.
- An orphan `residents/<id>/` goes only after nothing in it changed for 7 days (newest mtime, by `lstat`).
