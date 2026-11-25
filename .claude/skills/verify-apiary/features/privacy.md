# Privacy (strict mode, consents, retention, purge, export)

Settings → Privacy says what Apiary sends off the machine on its own, holds each automatic feature
until the person allows it, and keeps, purges and exports Apiary's own data. Main side:
`src/main/privacy/` (its `CLAUDE.md`), `src/main/app/privacyContainer.ts`,
`src/main/app/privacyTargetsContainer.ts`; shared: `src/shared/domain/privacy.ts`; decision:
ADR-0024.

## Sub-features

- Privacy mode, `privacy-strict` (a switch), on by default. Turning it off opens
  `privacy-consent-dialog` listing every feature not yet allowed (`privacy-disclosure-<feature>`);
  `privacy-consent-cancel` is the default and keeps it on, `privacy-consent-allow` turns it off.
  Turning it on asks nothing.
- What leaves this machine, `privacy-recipients`: one `privacy-row-<feature>` per feature in
  `PRIVACY_FEATURES` (`backgroundDigest`, `residentCycles`, `slackBridge`, `gitlabLookups`,
  `spellDictionaries`), each with `privacy-allow-<feature>` (opens the same dialog for that one) or
  `privacy-withdraw-<feature>` (a confirm with `privacy-withdraw-purge`, "Also delete what it
  produced", and `privacy-withdraw-cancel` / `-confirm`). A consent recorded by the v4 settings
  migration reads "Allowed — you had this on before privacy mode". Three rows are listed but not
  gated: the Claude usage meter (its own consent, ADR-0019), update checks, and your own sessions.
- Retention, `privacy-retention` (days, 1–3650, saved at once): the daily sweeper prunes digests,
  pasted images, scheduled-message logs and resident chat history older than this, and resident
  folders that are no longer configured.
- `privacy-purge` opens `privacy-purge-dialog` (a box per item; "Session names and notes" unchecked;
  `privacy-purge-confirm` disabled with nothing ticked), then `privacy-purge-result`. Nothing under
  the Claude config root is touched.
- `privacy-export` opens main's folder dialog and writes `apiary-export-<date>/`.
- Elsewhere: a resident card's `resident-digest-paused-<id>` ([residents.md](residents.md)), the
  Slack section's waiting line ([slack.md](slack.md)), and Diagnostics' "Privacy mode keeps logs at
  most 7 days."

## How to get to it (user POV)

Settings (Cmd+,) → Privacy, between General and Accounts. Settings search finds it by privacy, GDPR,
consent, purge, delete, export, retention, data, Anthropic, Slack or GitLab. In a remote window it
edits the work machine's consents.

## Driving it with launchApiary

Open Settings with `apiary:open-settings-dialog`, click `settings-nav-privacy`. Proof:
`privacy-strict` is checked; clicking it shows `privacy-consent-dialog` with a
`privacy-disclosure-<feature>`; `privacy-consent-cancel` leaves it checked; `settings.json` in
userData holds `gdprStrictMode: true`. The harness writes an unversioned `settings.json`, so the v4
migration runs on it and strict mode is on. `tests/e2e/settings.spec.ts` does these steps inside its
relaunch test.

## Gotchas

- To see a gated feature run in a drive, seed `gdprStrictMode: false` (or a consent in
  `privacyConsents`) in the launch settings.
- Export has no `APIARY_*` answer for its folder dialog, so a drive cannot complete it without a
  native dialog: leave it out.
- The purge's search-index item rebuilds the index from the sessions still listed, so `search.db`
  is not empty afterwards; removed sessions are no longer in it.
- No e2e spec drives purge, withdraw or the retention input; their states are in
  `tests/component/ui/privacy.ui.test.tsx` and `tests/component/privacySection.test.tsx`.
