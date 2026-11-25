# ADR-0024: Privacy mode is on by default, and each background feature needs its own consent

- **Status:** Accepted
- **Context:** Apiary's background features (the Regent digest, the residents' scheduled cycles, the
  Slack poll, the GitLab lookups, Linux's dictionary download) send conversation-derived data to
  Anthropic, Slack, GitLab or Google without anyone having been asked. The GDPR review
  (`docs/reviews/gdpr-compliance-review.md`, §3) found that consent was assumed from "enabled".
- **Decision:** `gdprStrictMode` is on for everyone. In it a feature runs only when `PrivacyGate.allows(feature)`
  is true: a `privacyConsents` entry with its own time and source (`user` or `migrated`), whose wording is
  `PRIVACY_DISCLOSURES`. Turning privacy mode off shows every disclosure first. A feature a person had
  already switched on keeps running, as a `migrated` consent written once by the v4 settings migration
  (Slack's by the Slack container).
- **Alternatives tried:** One global consent ("allow background processing"). Rejected: consent must be
  granular, a person who accepts the digest has not accepted a message posted to Slack, and a single
  switch cannot show who receives what.
- **Consequences:** A new feature that sends data off the machine on its own is a `PRIVACY_FEATURES`
  entry with its disclosure, and its start site asks the gate. A click is direct invocation and is not
  gated ("Check now"). Do not read "enabled" as consent.
- **Enforced by:** `tests/unit/architecture/privacyGated.test.ts` (each start site has its gate check before it,
  every feature has a site, the allowlist starts empty), and `tests/integration/privacy/strictModeEndToEnd.test.ts`.

Topic doc: `src/main/privacy/CLAUDE.md`.
