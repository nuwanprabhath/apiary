# ADR-0019: The Claude usage plugin asks once before it reads Claude Code's token

- **Status:** Accepted
- **Context:** The Claude usage status-bar plugin was on by default and, on first launch, read Claude
  Code's OAuth token (the macOS Keychain item "Claude Code-credentials", or
  the credentials file in Claude's config folder) and sent it as a Bearer token, with the beta header
  `anthropic-beta: oauth-2025-04-20`, to Anthropic's usage endpoint (api.anthropic.com, path /api/oauth/usage), an
  undocumented endpoint. Nobody was asked, and the Keychain read could raise a macOS prompt out of
  the blue. The 2026-10-07 review (§3.3) found it; `shared/redact.ts` still said Apiary holds no
  credential of its own.
- **Decision:** Ask once on first use. The plugin stays offered and on by default, but until the
  user answers it shows a neutral "Claude usage: allow access?" item and touches nothing: no
  Keychain, no credentials file, no network. The prompt says what is read (Claude Code's sign-in
  token), where it goes (only Anthropic's usage endpoint) and that Apiary never logs or stores it.
  Allow is remembered (`claudeUsageConsent`, a main-only field of `settings.json`); Don't allow
  turns the plugin off, and switching it back on in Settings, Plugins asks again. Installs that
  already ran the plugin are asked too: a missing answer means "not asked".
- **Alternatives tried:** Default off, by leaving `defaultEnabled` false (the review's other option):
  not taken, because the maintainer wants the feature offered where it is found, and a one-time
  question is the cost of that. Keeping the old behaviour and relying on a note in the plugin's
  description: it was already there, and the Keychain read happened before anyone read it.
- **Consequences:** The token is read per request and dropped, never stored; Anthropic's endpoint is
  the only place it goes. The diagnostic log never receives it (log redaction strips `sk-ant-` keys
  and Bearer headers, and nothing here passes it as a field). A new reader of Claude Code's
  credentials, or a second endpoint that receives the token, needs this ADR amended first.
- **Enforced by:** types: `readAccessToken` and `fetchLimits` take a `Consent`, which only
  `ConsentStore.proof()` mints once the answer is "granted"; ESLint `credentials-behind-consent`
  (the Keychain item, the credentials file and the endpoint are named only in `src/main/statusBar/claudeUsage/credentials.ts`
  and `limits.ts`) and `consent-minted-by-store` (no `as Consent`);
  `tests/unit/claudeUsageConsent.test.ts` (no read, no fetch before the answer; decline turns it off).

See [`src/main/statusBar/CLAUDE.md`](../../src/main/statusBar/CLAUDE.md).
