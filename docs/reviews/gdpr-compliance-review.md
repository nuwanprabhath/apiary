# GDPR compliance review: Privacy by Design and by Default (Art. 25)

- **Date:** 2026-11-25
- **Codebase:** main at 5a3f2c86 (1.89.2, unreleased)
- **Method:** source reading. Nothing was changed, and nothing was run against the network.
- **Scope:** every place Apiary stores, derives or transmits personal data. Line numbers are as of
  this commit; the code wins where it and this document differ.

## Who is the controller

Apiary is local software. It has no server, no telemetry and no account of its own, and the
maintainer receives nothing. Who the GDPR "controller" is depends on how Apiary is used:

- **Personal use:** the person running Apiary is usually covered by the household exemption
  (Art. 2(2)(c)).
- **Work use:** this is the case that matters. When an employee runs Apiary on a work machine,
  their employer is the controller of what Apiary processes. That includes other people's data,
  which then reaches third parties as processors:
  - colleagues' names, MR comments and review threads, sent to Anthropic by MR Desk;
  - Slack messages, read by the Slack bridge;
  - paths and commit metadata;
  - transcripts that quote customer data.

So what the code owes is Art. 25 itself: privacy-friendly defaults and minimal processing, so that
an employer can deploy Apiary without a data-protection impact assessment (DPIA) for each feature.

Art. 20 (portability) and Art. 15 (access) bind controllers, not software. Apiary helps a
controller meet them by keeping its data inspectable and exportable, and this review treats
export as a nice-to-have.

---

## 1. Executive Summary & Data Flow Inventory

### Summary

Apiary already does several things well:

- **Diagnostic log:** off by default. Conversation content is never passed to it. Home
  directories and credential shapes are redacted inside the logger, and retention is bounded
  (`src/main/log/`, `src/shared/redact.ts`).
- **Usage-meter token:** read only after an explicit, type-enforced consent (ADR-0019).
- **Credentials at rest:** the Slack token is encrypted with the OS keychain. Resident MCP tokens
  are mode 0600 and never appear in `ps`.
- **Paths:** the renderer never supplies one.
- **Opt-in features:** remote access, Slack and residents all start off.

The gaps are concentrated in four places:

1. **Bulk background processing by Anthropic is bundled into "turn on Regent".**
   - Enabling Regent starts a digest of the user's whole transcript history, sent to Anthropic
     through `claude`.
   - The default lookback is "all sessions", and nothing separate asks about it or discloses it.
   - MR Desk likewise sends colleagues' MR content to Anthropic every 15 minutes on its own
     schedule.
2. **Erasure does not reach derived data.**
   - "Remove session" only archives the row. The session's chunks stay in `search.db`, and its
     topic digests stay in `knowledge.db`, indefinitely.
   - A deleted transcript's digests are never dropped.
   - A deleted resident leaves its chat history on disk.
3. **Several stores grow without bound:**
   - `knowledge.db`;
   - `pasted-images/`;
   - `scheduled/<id>.log`, which holds `claude` output, i.e. conversation content;
   - residents' `history.json`, capped at 500 messages but with no age limit.
4. **Some outbound calls run by default without disclosure:**
   - the GitLab MR-status plugin runs `glab mr list` for every branch;
   - the updater contacts GitHub every 6 hours;
   - on Linux, Chromium fetches spelling dictionaries from Google.

There is also no single place that tells the user what leaves the machine, and no one-click purge.

The plan in §3 adds **`gdprStrictMode`**, on for fresh installs, together with per-feature consent
records, a retention sweeper, a purge service, a Privacy settings section with consent dialogs,
and tighter log redaction. It is cut into five workstreams with disjoint files.

### Data stores

All paths are under Electron's `userData` unless noted. "PII" here includes indirect identifiers:
usernames inside paths, hostnames, branch names, and free-text conversation content.

| Store | Data type | Contains PII? | Location | Third-party recipient | Retention / erasure today | Consent state |
| --- | --- | --- | --- | --- | --- | --- |
| Claude transcripts | full conversations | Yes, high | `~/.claude/projects/**.jsonl` | none from this store (Apiary only reads it) | Claude Code's own `cleanupPeriodDays`; Apiary never writes it | n/a (source data) |
| `apiary.db` | session index: titles, cwd, renames, notes, groups, archived flag | Yes (paths, titles, notes) | userData | none | forever; "Remove" sets `archived` (`sessionActions.ts:67-72`) | implicit (core function) |
| `search.db` | FTS5 chunks of transcript text, refs (`!1175`, URLs) | Yes, high | userData | none | rebuildable; a vanished file is forgotten (`indexer.ts:120-124`); archived sessions are kept | default **on** (`searchChatContent`, `schema.ts:142`) |
| `knowledge.db` | LLM topic digests (title, summary, keywords, refs) per session | Yes, high (summaries of conversations) | userData | produced *by* Anthropic | **forever**; only "re-digest" clears it all (`knowledgeStore.ts:167`); never per session | bundled with "enable Regent" |
| `settings.json` | preferences, resident configs (GitLab project, username) | Low (GitLab username, paths) | userData | none | forever | n/a |
| `library-state.json`, `session-layout.json` | pins, groups, tabs | Low | userData | none (mirrored to remote windows over SSH) | forever | n/a |
| `accounts.json`, `accounts/<id>/` | account labels; a per-account `CLAUDE_CONFIG_DIR` holding a login | Yes (credentials sit in Claude's files) | userData | Anthropic (Claude's own login) | until the account is removed | explicit (user adds it) |
| `residents/<id>/history.json` | resident chat, last 500 messages | Yes, high | userData, 0700 | none at rest | count cap only (`residentSpace.ts:11`); **left behind when the resident is deleted** (`residentService.ts:324-331`) | explicit (user adds a resident) |
| `residents/<id>/notes.json`, `state.json`, `mcp.json` | agent notes, session id, MCP bearer token | Medium | userData, 0600 / 0700 | none | same as above | explicit |
| `residents/<id>/mra/state` | MR Desk state: MR ids, draft bodies, nonces | Yes (colleagues' MR data) | userData | none at rest | forever | explicit |
| `slack.json` | encrypted token, channel, owner id, cursor, tasks, **awaiting message text in plaintext** (`slackStore.ts:12,26`) | Yes (Slack messages, member id) | userData | none at rest | done tasks 7 days / 200 (`slackTasks.ts:63-68`); `awaiting` until answered | explicit (Slack switch) |
| `scheduled-messages.json` | queued message text, session, time | Yes, high | userData, 0600 | none at rest | until sent | explicit |
| `scheduled/<id>.log` / `.done` | **`claude` stdout and stderr of a scheduled send** (`scheduledJobs.ts:85`) | Yes, high | userData | none at rest | **forever** (only `.running` and `.vars` are removed, `scheduledJobs.ts:92`) | explicit |
| `pasted-images/` | clipboard screenshots attached to chats | Yes (screenshots) | userData | Anthropic (via `claude`, user-initiated) | **forever** (`imageStore.ts:39-51`, no pruning) | user-initiated |
| `logs/` | diagnostic JSON lines | Low after redaction (hostnames, emails survive) | userData | none, unless the user sends it | 7 days / 20 MB by default (`schema.ts:185-189`); `logClear` | default **off** |
| Recent remote hosts | hostnames and times | Low/Medium (Tailscale names often contain a person's name) | userData (`hostDirectory.ts`) | the host itself (SSH probe every 10 minutes, `hostDirectory.ts:119`) | forever | user-initiated (they connected once) |
| Saved pairing codes | pairing secrets | Medium | userData, safeStorage-encrypted | none | until replaced | explicit |
| `~/.apiary/remote.sock` | served sessions | Yes, high (transcripts in transit) | `~/.apiary` | the SSH peer (the user's own machine) | live only | default **off** (`remoteAccess`) |
| Renderer `localStorage` (`uiState`) | UI conveniences | Low | Electron profile | none | forever | n/a |

### Outbound network calls and third-party processors

| Call | Data sent | PII? | Recipient | Trigger | Consent state |
| --- | --- | --- | --- | --- | --- |
| Background topic digest (`digester.ts:318`, `claude` one-shot) | windows of about 40k characters of user and assistant text, with tool names (`digester.ts:20,79-103`) | **Yes, high** | **Anthropic** | automatic while any digesting resident (Regent) is enabled and on duty (`residentService.ts:448-461`); default lookback **all sessions** (`residents.ts:25-27`) | **bundled** with enabling Regent; no separate notice |
| Regent chat (`residentChat.ts`) | the user's question, plus transcript excerpts it reads via MCP `read_session` | Yes, high | Anthropic | user message, Slack message, or Regent's own background turn | explicit for a typed message; implicit for Slack-originated and own turns |
| MR Desk cycle (`mrDesk.ts:19,109`) | MR titles, descriptions, colleagues' comments and diffs (`mra prompt`) | **Yes (third parties' data)** | **Anthropic**; GitLab via `glab` | **automatic every 15 minutes** during duty hours | bundled with enabling MR Desk |
| MR Desk pending check (`mra drafts`) | GitLab API calls under the user's `glab` login | Low | GitLab | automatic | bundled |
| Claude usage meter (`limits.ts:34,41-46`) | the OAuth bearer token for Claude Code | Credential | Anthropic `api.anthropic.com/api/oauth/usage` | poll | **explicit consent** (ADR-0019, `ConsentStore`); plugin `defaultEnabled: true` (`plugin.ts:287`) but asks first |
| Slack bridge (`slackApi.ts:81-83`, `slackContainer.ts:11`) | in: owner's channel messages; out: Regent replies and session milestones (summaries of session work) | Yes | **Slack** | poll every few seconds while enabled | explicit (switch), but **no disclosure that session content is posted to Slack** |
| GitLab MR-status plugin (`gitlabMr.ts:115,155`) | branch name, project path, under the user's `glab` token | Low/Medium (branch names often carry ticket ids or names) | the user's GitLab instance | automatic for every GitLab-remote folder shown | **default on** (`defaultEnabled: true`, `pluginService.ts:78`); no notice |
| Auto-updater (`electronUpdaterBackend.ts:71`) | IP, user-agent, current version, platform | Low (IP) | GitHub (Microsoft) | every 6 hours (`schema.ts:175`) | **default on**; disclosed only as "check for updates" |
| Chromium spellchecker dictionaries (`spellingService.ts:24`) | IP, language code | Low | Google CDN (Linux; macOS uses the native checker) | the first time a language is used | none (no `setSpellCheckerDictionaryDownloadURL`) |
| Remote windows (`main/remote/`) | transcripts, terminals and chats over an SSH tunnel | Yes, high | the user's own SSH peer (not a third party) | user-initiated | explicit; SSH-encrypted |
| Remote host probe (`hostDirectory.ts:119`) | SSH connection attempt | Low | the user's hosts | every 10 minutes for recent hosts | implicit |
| `git fetch` and other git commands | repository metadata | Low | the git remote | user-initiated | explicit |

### IPC channels that carry personal data or govern its lifecycle

All are declared in `src/shared/ipc/contract.ts`.

| Channel | Direction | Data | Notes |
| --- | --- | --- | --- |
| `logWrite` (`contract.ts:441-443`) | renderer → main | level, scope, message, **arbitrary fields** | `sendLoose`. Redacted, and capped at 512 characters per string and 50 items per array, but a careless renderer caller can still log message text. |
| `logStatus` / `logReveal` / `logClear` | invoke | log metadata | Existing erasure for logs. |
| `removeSession` | invoke | session id | **Archives only** (finding GDPR-02). |
| `searchRebuild` | invoke | none | Clears and rebuilds `search.db`. |
| `residentClear` | invoke | resident id | Clears one resident's history. |
| resident re-digest (Settings) | invoke | resident id | `Digester.reset`: wipes all of `knowledge.db`. |
| `slack*` | invoke | token (in only), channel, owner id | The token never comes back to the renderer. |
| `transcript*`, `chat*`, `searchContent` | invoke and push | conversation content | Remote-scoped: crosses SSH in remote windows. |

---

## 2. GDPR Findings (Prioritized by Severity)

Severity reflects the Art. 25 risk in the work-use case, where third parties' data is involved.

### GDPR-01: Background digest of the whole transcript history to Anthropic is bundled into "enable Regent" (High)

- **Principle / Article:**
  - Art. 25(2), privacy by default;
  - Art. 5(1)(b) purpose limitation and 5(1)(c) data minimisation;
  - Art. 13(1)(e), recipients disclosed.
- **Affected files:**
  - `src/main/residents/kinds.ts:12-27`: Regent defaults to `digests: true`, `digestModel: 'haiku'`.
  - `src/shared/settings/residents.ts:25-27`: `digestLookback: null`, meaning all sessions, ever.
  - `src/main/residents/residentService.ts:448-461`: `reconcileDigest` starts the digest whenever
    any digesting resident is enabled and on duty.
  - `src/main/knowledge/digester.ts:20,79-103,318`: about 40k characters of user and assistant
    text per call, sent through `claude`.
- **Risk:**
  - A user who turns Regent on to ask "find my session about X" also starts unattended bulk
    transmission of every transcript they have ever recorded. That covers pasted secrets, customer
    data, and colleagues' names quoted in sessions.
  - The digest runs on Haiku in the background, with no per-feature switch, no notice of what is
    sent, and no limit on how far back it reads.
  - On a work machine this is a new purpose (indexing) running on a different legal basis from
    the interactive chat the user asked for.
- **Recommended fix:**
  - Separate consent `backgroundDigest`, which `gdprStrictMode` requires.
  - New Regents default to `digestLookback: { months: 1 }` instead of `null`.
  - The resident card and status say "Digest paused: needs your OK" while consent is missing.
  - The digester checks the gate before every model call, not only at `resume`, so withdrawing
    consent stops the next window.

### GDPR-02: "Remove session" leaves the session's text in `search.db` and its digests in `knowledge.db` (High)

- **Principle / Article:** Art. 17, the right to erasure; Art. 5(1)(e), storage limitation.
- **Affected files:**
  - `src/main/sessions/sessionActions.ts:67-72`: `removeSession` only calls `setArchived`.
  - `src/main/search/indexer.ts:120-124`: forgets a session only when its file vanishes. No code
    in `src/main/search/` or `src/main/knowledge/` mentions `archived`.
  - `src/main/knowledge/knowledgeStore.ts:167`: the only deletion is `DELETE FROM topics; DELETE
    FROM digested;`. There is no per-session delete, and nothing drops digests of transcripts that
    no longer exist.
- **Risk:**
  - A user removes a session because it held something sensitive. Its full text stays searchable
    in `search.db`.
  - Its LLM-written summary stays in `knowledge.db` forever, and Regent can still surface it (it
    searches topics).
  - When Claude Code's own cleanup deletes the JSONL, the digests outlive the source.
- **Recommended fix:**
  - `KnowledgeStore.forget(sessionId)` and `forgetMissing(liveIds)`.
  - `removeSession` calls `search.forget` and `knowledge.forget`.
  - The index pass skips archived sessions.
  - The retention sweeper calls `forgetMissing` daily.
  - "Remove" becomes "Remove from Apiary (also deletes its search index and digest)".

### GDPR-03: MR Desk sends third parties' data to Anthropic on its own schedule (High)

- **Principle / Article:** Art. 25(2); Art. 5(1)(c); Art. 14 (data not obtained from the data
  subject: colleagues are not told).
- **Affected files:**
  - `src/main/residents/kinds/mrDesk.ts:19` (`CYCLE_DEFAULT_MINUTES = 15`) and `:109` (`cycle`);
  - `src/main/residents/quickActions.ts` (`cycleSkip`);
  - `resources/residents/mra/` (`mra prompt` builds the review context from MR titles, bodies,
    comments and diffs).
- **Risk:** every 15 minutes during duty hours, colleagues' review comments and code are sent to
  Anthropic without anyone typing anything. Prompt-injection hardening is present (`<<<UNTRUSTED`),
  but minimisation and transparency are not.
- **Recommended fix:**
  - Separate consent `residentCycles`, which strict mode requires. Manual quick actions ("Check my
    MRs now") stay allowed, since they are direct invocation.
  - A new `cycleSkip` reason `consent`, shown in the status.

### GDPR-04: Unbounded retention of derived and auxiliary stores (Medium)

- **Principle / Article:** Art. 5(1)(e), storage limitation; Art. 25(2) (period of storage).
- **Affected files:**
  - `knowledge.db`: no TTL (`knowledgeStore.ts`).
  - `src/main/media/imageStore.ts:39-51`: pasted screenshots are never deleted.
  - `src/main/schedule/scheduledJobs.ts:85,92`: `<id>.log` and `.done` hold `claude` output and are
    never removed.
  - `src/main/residents/residentSpace.ts:11`: 500-message cap, no age limit.
  - `slack.json` `awaiting` entries (`slackStore.ts:12`), plaintext message text.
- **Risk:** conversation content and screenshots accumulate for the life of the install, outside
  Claude Code's own retention setting, which users reasonably assume covers "their transcripts".
- **Recommended fix:**
  - A `RetentionSweeper` (daily, and at start) driven by `dataRetentionDays` (default 30, range
    1-3650). It covers:
    - images older than N days that no live transcript still references;
    - scheduled `.log` and `.done` files older than N days;
    - resident history entries older than N days;
    - Slack `awaiting` entries older than 24 hours;
    - digests of missing or archived sessions.
  - Strict mode clamps `logRetentionDays` to at most 7.

### GDPR-05: Deleting a resident leaves its space on disk (Medium)

- **Principle / Article:** Art. 17; Art. 5(1)(e).
- **Affected files:** `src/main/residents/residentService.ts:324-331`. It stops the process,
  revokes the token and forgets pending checks, but `userData/residents/<id>/` stays, with
  `history.json`, `notes.json`, `mra/state` and `claude-settings.json`.
- **Risk:** a user who deletes MR Desk believes its chat and colleagues' data are gone.
- **Recommended fix:** the sweeper removes any `residents/<id>/` whose id is not in `settings.residents`
  (through `main/fs`, with a confined real path). No `residentService.ts` change is needed.

### GDPR-06: The Slack bridge posts session content to Slack without disclosure, and keeps message text in plaintext (Medium)

- **Principle / Article:** Art. 13(1)(e); Art. 32 (security of processing); Art. 25(2).
- **Affected files:**
  - `src/main/desk/slackDesk.ts:54,105`: replies and milestones are posted;
  - `src/main/slack/slackStore.ts:12,26`: `awaiting[].text` is stored unencrypted;
  - `src/renderer/features/settings/sections/SlackSection.tsx`: the switch says "Take instructions
    from Slack", not "Session progress will be posted to #channel".
- **Risk:**
  - Session milestones (what Claude did, file names, errors) become Slack workspace data, retained
    and exported under the workspace's policy and visible to every member of the channel.
  - The owner-id check (`slackPoller.ts`) is correct access control, but the outbound direction is
    not disclosed.
- **Recommended fix:**
  - Strict mode requires consent `slackBridge`, with a dialog stating both directions.
  - Encrypt `awaiting[].text` with the same `CodeCipher`, or drop it after 24 hours (GDPR-04).

### GDPR-07: The GitLab MR-status plugin queries GitLab by default for every branch (Medium)

- **Principle / Article:** Art. 25(2); Art. 5(1)(c).
- **Affected files:** `src/main/plugins/gitlabMr.ts:115` (`defaultEnabled: true`) and `:155`
  (`glab mr list --all --source-branch <branch>`); `src/main/plugins/pluginService.ts:78`.
- **Risk:**
  - Low sensitivity, since the request goes to the user's own GitLab under their own token. It is
    still an automatic outbound call carrying branch names, which often hold ticket ids or names,
    made without the user knowing.
  - A self-hosted GitLab logs each query against the user.
- **Recommended fix:** consent `gitlabLookups` in strict mode. Until it is given the plugin shows
  only the offline half ("open the MR form"), which needs no `glab` (`gitlabMr.ts:18`).

### GDPR-08: Log redaction misses emails, hostnames, `/root` and SSH `user@host` (Medium)

- **Principle / Article:** Art. 5(1)(c); Art. 25(1) (pseudonymisation).
- **Affected files:**
  - `src/shared/redact.ts:34-51`: the secret patterns, plus `HOME_LIKE` for only `/Users/*` and
    `/home/*`.
  - `src/main/remote/remoteClientService.ts:165-189,343-360`: `host` is logged raw.
  - `src/main/log/logger.ts:113-131`: field keys are not redacted.
- **Risk:**
  - Tailscale and SSH hostnames routinely contain a person's name (`firstname-laptop.tailnet.ts.net`).
  - `git` and `glab` errors echo `user@example.com`.
  - Paths under `/root` and `/var/home/<user>` (Fedora Silverblue) keep the username.
  - A log the user is asked to send then identifies them and their colleagues.
- **Recommended fix:** add these rules in `redactString`, so every existing call gets them:
  - an email shape becomes `[email]`;
  - `ssh://user@` and `user@host:` become `[user]@`;
  - home roots `/root`, `/var/home/<u>` and `C:\Users\<u>` are rewritten;
  - in strict mode, any field named `host`, `hostname` or `remote` is pseudonymised as
    `host-<first 8 hex characters of sha256(salt + value)>`, with a salt per install.

### GDPR-09: `logWrite` accepts arbitrary renderer fields (Low)

- **Principle / Article:** Art. 25(1).
- **Affected files:** `src/shared/ipc/contract.ts:441-443` (`sendLoose`, `opt(record)`).
- **Risk:** the "never pass conversation content" rule is a judgment call (CLAUDE.md), and nothing
  enforces it for renderer callers. A component that logs `{ text }` writes up to 512 characters
  of message text.
- **Recommended fix:**
  - Strict mode drops any field whose key is in a deny list (`text`, `message`, `body`, `prompt`,
    `content`, `reply`, `query`) and any string field over 200 characters.
  - Add an architecture test that renderer `log*` call sites do not pass those keys.

### GDPR-10: No one-click purge, and no single view of "what leaves this machine" (Low)

- **Principle / Article:** Art. 12 (transparent information); Art. 17; Art. 20 (supporting
  portability).
- **Affected files:** `src/renderer/features/settings/sections/` has no Privacy section. Erasure
  is scattered across the log clear button, search rebuild, re-digest and resident clear.
- **Recommended fix:**
  - A Privacy section that lists every recipient, with the per-feature consent switches and the
    date each was granted.
  - "Purge Apiary indexes, digests and logs". It never touches `~/.claude`, and it deletes source
    transcripts only behind a separate, explicit, typed confirmation that is not offered by
    default.
  - "Export my Apiary data" writes digests, resident histories and notes as JSON to a folder chosen
    in main's dialog.

### GDPR-11: The update check runs by default without disclosure (Low)

- **Principle / Article:** Art. 13; ePrivacy-style transparency. Legitimate interest (security
  updates) is a sound basis, but it should be stated.
- **Affected files:** `src/shared/settings/schema.ts:175` (`updateAutomaticChecks: true`, every 6
  hours); `src/main/update/electronUpdaterBackend.ts:71`.
- **Recommended fix:** keep it on, since security fixes outweigh the risk, and list it in the
  Privacy section as "GitHub sees your IP address and Apiary version every 6 hours", linking to the
  switch. Strict mode does not turn it off.

### GDPR-12: Linux spellchecker fetches dictionaries from Google (Low)

- **Principle / Article:** Art. 25(2); Art. 44 (transfer).
- **Affected files:** `src/main/spelling/spellingService.ts:24`. No
  `setSpellCheckerDictionaryDownloadURL` is set, so Chromium uses Google's CDN.
- **Recommended fix:** under strict mode on Linux, hold `setSpellCheckerLanguages` until the
  `spellDictionaries` consent is given, or point the download URL at a bundled `file://` copy.
  List it in the Privacy section.

### GDPR-13: The usage meter is enabled by default, though gated by consent (Informational)

- **Principle / Article:** Art. 25(2).
- **Affected files:** `src/main/statusBar/claudeUsage/plugin.ts:287` (`defaultEnabled: true`),
  `consent.ts`, ADR-0019.
- **Assessment:** already compliant. Nothing is read or sent before an explicit Allow, and the
  type system enforces it.
- **Action:** the Privacy section shows the consent and lets the user withdraw it. Strict mode adds
  nothing here; `ConsentStore` stays the single owner of this one consent, so ADR-0019 does not
  change.

### GDPR-14: Residents start with `permissionMode: 'auto'` and Regent's own turns run unattended (Informational)

- **Principle / Article:** Art. 25(1).
- **Affected files:** `src/shared/settings/residents.ts:25-27`.
- **Assessment:**
  - Not a data-protection fault in itself, because the tools are local.
  - Combined with GDPR-01 and GDPR-03, an `auto` resident can read any session (through MCP) and
    send it to Anthropic in a turn of its own.
  - `readOtherAccounts: false` (`schema.ts:204`) correctly limits it to the resident's own account.
- **Action:** none beyond GDPR-01 and GDPR-03. Note it in the consent dialog text.

---

## 3. Parallel Subagent Implementation Plan

### Design: `gdprStrictMode`

#### Shared types (new file `src/shared/domain/privacy.ts`)

```ts
/** Each automatic processing that strict mode holds until the user agrees to it. */
export const PRIVACY_FEATURES = [
  'backgroundDigest',   // GDPR-01: Regent's topic digest, transcripts to Anthropic
  'residentCycles',     // GDPR-03: a resident's scheduled cycle prompt (MR Desk), to Anthropic
  'slackBridge',        // GDPR-06: Slack polling in, session milestones out
  'gitlabLookups',      // GDPR-07: the MR-status plugin's glab calls
  'spellDictionaries',  // GDPR-12: Linux dictionary download from Google
] as const
export type PrivacyFeature = (typeof PRIVACY_FEATURES)[number]

export interface PrivacyConsent {
  grantedAt: number            // epoch ms
  source: 'user' | 'migrated'  // 'migrated': the feature was already on before strict mode existed
}
export type PrivacyConsents = Partial<Record<PrivacyFeature, PrivacyConsent>>

/** One line per recipient, shown in Settings → Privacy and in each consent dialog. */
export const PRIVACY_DISCLOSURES: Record<PrivacyFeature, { recipient: string; sends: string; when: string }> = { /* filled by A */ }

export const isPrivacyFeature: Guard<PrivacyFeature>
export const isPrivacyConsents: Guard<PrivacyConsents>

/** The one rule: strict off means allowed; strict on means allowed only with a consent. */
export function privacyAllows(strict: boolean, consents: PrivacyConsents, feature: PrivacyFeature): boolean {
  return !strict || consents[feature] !== undefined
}

export interface PurgeRequest {
  searchIndex: boolean          // search.db: cleared and rebuilt
  digests: boolean              // knowledge.db: Digester.reset
  logs: boolean                 // logs/
  residentHistory: boolean      // residents/*/history.json, notes.json, mra/state
  slackMessages: boolean        // slack.json tasks and awaiting (keeps token, channel, owner)
  pastedImages: boolean         // pasted-images/
  scheduledLogs: boolean        // scheduled/*.log, *.done (never a pending .vars)
  sessionMetadata: boolean      // apiary.db renames, notes, archived rows; default false in the UI
}
export interface PurgeResult { removedBytes: number; failed: { item: keyof PurgeRequest; reason: string }[] }
```

#### Settings, in `SETTINGS` (`src/shared/settings/schema.ts`), all `machine` scope

- `gdprStrictMode: machine(flag(true))`
- `privacyConsents: machine(setting<PrivacyConsents>({ guard: isPrivacyConsents, default: {} }))`
- `dataRetentionDays: machine(int(30, 1, 3650))`
- Add `gdprStrictMode`, `privacyConsents` and `dataRetentionDays` to `INSTANT_SETTINGS`: the
  Privacy section saves at once, like Residents.

#### Fresh installs and existing installs

- `SETTINGS_VERSION` goes from 3 to 4 (`src/main/settings.ts:20`), with a `migrateToV4` in
  `migrateSettings`. CLAUDE.md requires a migration when a default changes, and a new key's default
  would otherwise apply silently to existing users.
- **Fresh install** (no `settings.json`): `gdprStrictMode: true`, `privacyConsents: {}`.
- **Existing install** (v3 file): `gdprStrictMode: true`. A feature the user had already
  explicitly turned on gets `{ source: 'migrated', grantedAt: <migration time> }`, because that
  was an affirmative act and silently breaking a configured Regent or Slack bridge would be worse:
  - any enabled resident whose kind digests gives `backgroundDigest` and `residentCycles`;
  - an enabled MR Desk gives `residentCycles`;
  - `slack.json` `enabled` gives `slackBridge`. This file is separate, so the migration only marks
    a flag; `SlackContainer` converts it at its first start;
  - `gitlabLookups` is migrated only if `plugins['gitlab-mr'] === true` was set explicitly.
- A one-time notice ("Privacy mode is on. 3 features keep running because you turned them on; see
  Settings → Privacy") is shown once, keyed by a `uiState` flag.

#### Turning strict mode off

- A confirmation dialog lists every `PRIVACY_DISCLOSURES` entry for features not yet consented,
  with Cancel as the default button.
- Turning it off writes `gdprStrictMode: false` and leaves `privacyConsents` as they are, so
  turning it back on restores the same set.

#### Withdrawing consent

- Removes the key. Every gate re-reads settings on change: the digest pauses before its next model
  call, Slack's timer stops, cycles skip, and the plugin falls back to its offline half.
- Withdrawal deletes nothing by itself. The dialog offers "Also delete what it produced" (for
  example, digests for `backgroundDigest`), which calls the purge with the matching items.

#### Retention, enforced by `RetentionSweeper`

| Store | Rule |
| --- | --- |
| `knowledge.db` | digests of missing or archived sessions are dropped; digests not refreshed for `dataRetentionDays` are dropped |
| `pasted-images/` | files older than `dataRetentionDays` |
| `scheduled/*.log`, `*.done` | files older than `dataRetentionDays` |
| `residents/*/history.json` | entries older than `dataRetentionDays` |
| orphan `residents/<id>/` | removed |
| Slack `awaiting` | entries older than 24 hours |
| logs | strict mode clamps the effective `logRetentionDays` to at most 7, applied in `log/configure.ts`; the stored value is kept |

The sweeper runs at start (after 60 seconds) and every 24 hours. It runs in strict and non-strict
mode alike, because storage limitation is not a convenience trade-off.

#### Purge

- `privacyPurge(PurgeRequest) → PurgeResult`.
- **It never touches `~/.claude`.** The confinement is a real-path check against `userData`.
- Deleting source transcripts is out of scope for this plan. If it is ever added, it is a separate
  channel behind a typed confirmation.

### Workstreams

#### Merge order and shared rules

- **A merges first.** B, C and D start from the release branch after A has merged:
  `git merge --no-edit <release-branch>`.
- After A, workstreams B, C, D and E touch disjoint files. Each one writes its own unit and
  component tests for its own files. E owns cross-cutting integration tests, e2e and docs.
- Version bumps and `CHANGELOG.md` entries are **made by the lead at merge time**, one version per
  merged workstream. Agents do not touch `package.json`, `package-lock.json` or `CHANGELOG.md`,
  because those would conflict.
- Follow `.claude/skills/agent-orchestration/SKILL.md`:
  - worktrees in `.worktrees/<wp>`;
  - at most six agents at once;
  - the Stop hook run on each branch;
  - `trim-comments` before each merge.
- Baselines and allowlists never grow.

---

#### Subagent A: Settings Schema, Privacy Domain, IPC Contract and Wiring (phase 0)

**Files.** Only A edits these.

- Create:
  - `src/shared/domain/privacy.ts` (the types above, plus `PRIVACY_DISCLOSURES` text and the guards);
  - `src/main/privacy/privacyGate.ts`;
  - `src/main/privacy/types.ts`;
  - `src/main/ipc/handlers/privacy.ts`;
  - `tests/component/fake/privacy.ts`;
  - `tests/contract/clauses/privacy.ts`;
  - `tests/unit/privacyDomain.test.ts`;
  - `tests/unit/settingsMigrationV4.test.ts`.
- Modify:
  - `src/shared/settings/schema.ts`;
  - `src/main/settings.ts` (`SETTINGS_VERSION = 4`, `migrateToV4`);
  - `src/shared/ipc/contract.ts`;
  - `src/main/ipc/registrar.ts` (handler registration);
  - `src/main/remote/scopes.ts` (new channels: `privacyPurge`, `privacyExport` and
    `privacyStatus` are `remote`; `privacyExport` uses main's dialog, so it is `local`);
  - `src/main/app/container.ts`, `src/main/app/residentsContainer.ts`,
    `src/main/app/knowledgeContainer.ts`, `src/main/app/slackContainer.ts` (pass `privacyGate`
    in; add the field to each options type only);
  - `src/main/plugins/pluginService.ts` (pass `privacyGate` into `BuiltinPluginConfig`);
  - `tests/component/fake/index.ts` (register the fake);
  - `tests/unit/architecture/*.allow.json` only if a new channel needs a reasoned entry (prefer
    none).

**Spec.**

1. Write `src/shared/domain/privacy.ts` exactly as in the design. `isPrivacyConsents` accepts only
   known feature keys, each `{ grantedAt: finite number > 0, source: 'user' | 'migrated' }`, and
   drops unknown keys rather than rejecting the whole record.
2. Add the three settings to `SETTINGS` and to `INSTANT_SETTINGS`.
3. Write `migrateToV4(raw, ctx: { now: number })`, pure and covered by tests:
   - set `gdprStrictMode: true` if absent;
   - derive the migrated consents from `raw.residents` and `raw.plugins` as in the design;
   - set `privacyConsentsMigratedSlack: true` only when the caller passes
     `ctx.slackEnabled === true`. The settings service reads `slack.json` through `SlackStore`'s
     loader before migrating. If that crosses a layer rule, instead have `slackContainer` convert
     at start, owned by B. **Decision: the container converts at start (B).** A's migration
     ignores Slack.
4. Write `PrivacyGate` in `src/main/privacy/privacyGate.ts`:

   ```ts
   export interface PrivacyGate {
     allows(feature: PrivacyFeature): boolean
     onChange(listener: () => void): () => void   // fires when gdprStrictMode or privacyConsents change
     grant(feature: PrivacyFeature, source?: 'user' | 'migrated'): Promise<void>
     revoke(feature: PrivacyFeature): Promise<void>
     strict(): boolean
   }
   export function createPrivacyGate(settings: SettingsService, now: () => number = Date.now): PrivacyGate
   ```

   `allows` delegates to `privacyAllows`.
5. Add the IPC entries, each with a strict guard in `contract.ts`:
   - `privacyStatus: invoke<[], PrivacyStatus>`, where
     `PrivacyStatus = { strict, consents, disclosures, retentionDays, usageConsent: 'allowed' | 'denied' | 'unasked' }`.
     The usage consent is read from `ConsentStore`, which stays the owner (ADR-0019);
   - `privacyGrant: invoke<[feature: PrivacyFeature], void>`;
   - `privacyRevoke: invoke<[feature: PrivacyFeature, alsoPurge: boolean], void>`;
   - `privacySetStrict: invoke<[strict: boolean], void>`;
   - `privacyPurge: invoke<[req: PurgeRequest], PurgeResult>`, with a guard of every key boolean,
     no extras;
   - `privacyExport: invoke<[], string | null>`. Main opens the folder dialog; the renderer never
     supplies a path;
   - `privacyChanged: event<PrivacyStatus>`.
6. The handler validates and delegates to an injected `PrivacyService` interface (`types.ts`):
   `purge`, `export`, `status`. C implements it. Until C merges, A wires a stub that throws "not
   implemented", so the contract clause for purge is marked as expecting C (see E).
7. Fake: it mirrors `privacyChanged` and runs every call through the contract guard
   (`tests/component/fake/<area>.ts` pattern).
8. Contract clause: status round-trip; grant then revoke; refusing an unknown feature; refusing a
   `PurgeRequest` with an extra key.

**Verification.**

```sh
npm run typecheck && npm run lint
npm test -- tests/unit/privacyDomain.test.ts tests/unit/settingsMigrationV4.test.ts tests/unit/settingsSchema.test.ts
npm test -- tests/unit/architecture
npm run test:component -- tests/component   # the fake still compiles against ApiaryApi
```

---

#### Subagent B: Background Processing Gates (Residents, Digest, Slack, GitLab plugin, Spelling)

**Files.**

- Modify:
  - `src/main/residents/residentService.ts` (`reconcileDigest`; status `digestPaused`);
  - `src/main/residents/quickActions.ts` (`cycleSkip` reason `consent`);
  - `src/main/residents/cycle.ts` (status text);
  - `src/main/knowledge/digester.ts` (re-check the gate before each window);
  - `src/main/slack/slackBridge.ts` (timer start and stop on the gate);
  - `src/main/slack/slackStore.ts` (`awaiting` text encrypted);
  - `src/main/app/slackContainer.ts` (bodies only, after A's type change; the migrated Slack
    consent);
  - `src/main/plugins/gitlabMr.ts` (offline-only while not allowed);
  - `src/main/spelling/spellingService.ts`;
  - `src/shared/settings/residents.ts` (Regent's `digestLookback` default for *new* residents,
    `{ months: 1 }`, via the kind defaults, not `RESIDENT_FIELD_DEFAULTS`, which describe old
    configs);
  - `src/main/residents/kinds.ts` (Regent `defaults.digestLookback`);
  - `src/shared/domain/residents.ts` (add `digestPaused: 'consent' | 'usage' | null` to the status
    type).
- Create:
  - `tests/unit/residents/privacyGating.test.ts`;
  - `tests/unit/knowledge/digesterGate.test.ts`;
  - `tests/unit/slack/slackPrivacyGate.test.ts`;
  - `tests/unit/gitlabMrPrivacy.test.ts`;
  - `tests/unit/spellingPrivacy.test.ts`.

**Spec.**

1. `reconcileDigest`: a driver is chosen only if `gate.allows('backgroundDigest')`. Otherwise call
   `digest.pause()` and set the status `digestPaused: 'consent'`. Include
   `gate.allows('backgroundDigest')` in `digestKey`, so a grant resumes at once. Subscribe to
   `gate.onChange` → `reconcile()`.
2. Digester: add `shouldPause` OR `!gateAllows()` (injected `() => boolean`) before each model call.
   That is the check at line 283, extended. Withdrawal mid-pass sends no further window. Progress
   already written is kept.
3. `cycleSkip(…, { consent: boolean })`: when false, return `{ skip: 'consent' }` for a whole
   cycle, and log it once per change, not per minute. Manual quick actions, including the `cycle`
   id when the user clicks "Check now", are **not** gated: a click is direct invocation. The
   status text reads "Paused: needs your OK in Settings → Privacy".
4. `SlackBridge`: `start()` arms the timer only when `allows('slackBridge')`. On a change to
   false, stop the timer without dropping state; on true, re-arm. The status becomes `off` with
   the sentence "Waiting for your OK in Settings → Privacy." At container start, if `slack.json`
   has `enabled: true` and `privacyConsents.slackBridge` is absent, call
   `gate.grant('slackBridge', 'migrated')` exactly once, then never again: keyed on the A
   migration's version, `schemaVersion === 4`, and a `slackConsentMigrated` field in `slack.json`.
5. `slackStore`: encrypt `awaiting[].text` with the injected `CodeCipher`. On load, plaintext
   entries from older files are re-encrypted. A decrypt failure drops the entry and is logged as a
   count only.
6. `gitlabMr`: when `!allows('gitlabLookups')`, never call `exec`, and return the offline item
   ("Open MR form").
7. Spelling: on Linux, `setSpellCheckerLanguages` only when `allows('spellDictionaries')`;
   otherwise `[]`. macOS is unaffected (native checker).
8. Edge cases:
   - a gate that throws counts as **not allowed** (fail closed);
   - strict off allows everything;
   - consent granted while off duty takes effect at the next on-duty reconcile.

**Verification.**

```sh
npm run typecheck && npm run lint
npm test -- tests/unit/residents tests/unit/knowledge tests/unit/slack tests/unit/gitlabMrPrivacy.test.ts tests/unit/spellingPrivacy.test.ts
npm run test:integration -- tests/integration/residents tests/integration/desk
```

---

#### Subagent C: Log Scrubbing, Retention Sweeper, Purge and Export Service

**Files.**

- Modify:
  - `src/shared/redact.ts`;
  - `src/main/log/logger.ts` (strict field deny list; host pseudonymisation; salt);
  - `src/main/log/configure.ts` (effective retention clamp);
  - `src/main/log/CLAUDE.md`;
  - `src/main/knowledge/knowledgeStore.ts` (`forget`, `forgetMissing`, `forgetOlderThan`);
  - `src/main/search/indexer.ts` (skip archived);
  - `src/main/search/searchService.ts` (`forget(sessionId)` passthrough);
  - `src/main/sessions/sessionActions.ts` (`removeSession` also forgets derived data);
  - `src/main/media/imageStore.ts` (`pruneOlderThan`, `clear`);
  - `src/main/schedule/scheduledJobs.ts` (`pruneFinished(olderThanMs)`, `clearLogs`);
  - `src/main/residents/residentSpace.ts` (`pruneHistoryOlderThan`, a static `removeOrphans(dir,
    liveIds)`);
  - `src/main/slack/slackTasks.ts` (`clearMessages`).
  - **B owns `slackStore.ts`; C calls only `SlackTasks`.**
- Create:
  - `src/main/privacy/retentionSweeper.ts`;
  - `src/main/privacy/purgeService.ts`;
  - `src/main/privacy/exportService.ts`;
  - `src/main/privacy/CLAUDE.md`;
  - `tests/unit/redactPrivacy.test.ts`;
  - `tests/unit/privacy/retentionSweeper.test.ts`;
  - `tests/unit/privacy/purgeService.test.ts`;
  - `tests/unit/privacy/exportService.test.ts`;
  - `tests/integration/knowledgeForget.test.ts`;
  - `tests/integration/removeSessionErases.test.ts`.
- A has already wired the `PrivacyService` stub. C replaces the stub's construction in
  **`src/main/app/privacyContainer.ts`**, a new file C creates. A's `container.ts` calls
  `createPrivacy(...)` from it, and A leaves a one-line import of that function that C fills.
  **Decision: A creates `privacyContainer.ts` with the stub, and C owns it after A merges.**

**Spec.**

1. `redactString`, with these additions placed before `HOME_LIKE`:
   - `/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g` becomes `[email]`;
   - `/\b([a-z][a-z0-9+.-]*:\/\/)?[A-Za-z0-9._-]+@(?=[A-Za-z0-9.-]+[:/])/g` becomes `$1[user]@`;
   - extend `HOME_LIKE` to `/(?:Users|home|var\/home)\/[^/\s"')]+` and `/root\b`, plus a Windows
     form `[A-Za-z]:\\Users\\[^\\\s"']+`.
   - Keep each rule narrow (redact.ts's own guidance). Tests cover a false positive (a plain
     `git@` SSH remote keeps `git@`) and every new shape.
2. `Logger` gets a `strict: () => boolean` option. When strict:
   - drop fields whose key matches `/^(text|message|body|prompt|content|reply|query)$/i`;
   - truncate strings at 200 characters instead of 512;
   - replace `host`, `hostname` and `remote` values with `host-<sha256(salt+v)[0..8]>`. The salt is
     32 random bytes in `logs/.salt` (0600), created with the directory and removed by `logClear`.
   - `msg` is redacted as before, never dropped.
3. `configure.ts`: `retentionDays = strict ? Math.min(settings.logRetentionDays, 7) : settings.logRetentionDays`.
4. `KnowledgeStore`:
   - `forget(sessionId)` deletes from `topics` and `digested` in one transaction;
   - `forgetMissing(live: Set<string>)` deletes every `session_id` not in it;
   - `forgetOlderThan(ms)` deletes rows whose `digested.at` is older.
5. `removeSession`: after `setArchived`, call `search.forget(id)` and `knowledge.forget(id)`
   through injected deps (`SessionActionsDeps` gains
   `forgetDerived: (id: SessionId) => Promise<void>`). A failure is logged and does not undo the
   archive. `runIndexPass` skips archived sessions and forgets them if they are present.
6. `RetentionSweeper`:

   ```ts
   export function createRetentionSweeper(deps: {
     settings: () => { dataRetentionDays: number; residents: { id: string }[] }
     knowledge: { forgetMissing(live: Set<string>): void; forgetOlderThan(ms: number): void } | null
     liveSessionIds: () => Set<string>   // non-archived ids from the store
     images: { pruneOlderThan(ms: number, keep: Set<string>): Promise<number> }
     referencedImages: () => Promise<Set<string>>  // basenames still named in live transcripts
     scheduled: { pruneFinished(olderThanMs: number): number }
     residentsDir: string
     residentSpace: { pruneHistoryOlderThan(id: string, ms: number): Promise<void> }
     slackTasks: { dropAwaitingOlderThan(ms: number): void } | null
     now: () => number
     setTimer: typeof setTimeout
   }): { start(): void; stop(): void; runOnce(): Promise<SweepReport> }
   ```

   - Start at 60 seconds, then every 24 hours.
   - Each step is isolated (one failure never stops the others) and logs counts only.
   - `removeOrphans` uses `realPathInside(residentsDir)` and the `RESIDENT_ID_RE` slug check
     before deleting, and never follows a symlink.
7. `PurgeService.purge(req)`. Each item:
   - `searchIndex` → `searchService.rebuild()` (existing);
   - `digests` → `digest.reset()` (existing);
   - `logs` → `logger.clear()` (existing);
   - `residentHistory` → for each resident: stop its chat, clear history, notes and `mra/state`,
     then restart if it was enabled. Use the existing `residentClear` for history; notes and state
     go through `ResidentSpace`;
   - `slackMessages` → `slackTasks.clearMessages()` (keeps the token, channel and owner);
   - `pastedImages` → `imageStore.clear()`;
   - `scheduledLogs` → `scheduledJobs.clearLogs()`. Never remove a `.vars` whose schedule is
     pending;
   - `sessionMetadata` → `store.clearUserMetadata()` (renames, notes, archived rows).

   Every deletion target is checked with `realPathInside(app.getPath('userData'))`. Nothing under
   the Claude config root is touched; the test asserts it by planting a file there. Results are
   reported per item. `removedBytes` is measured before and after.
8. `ExportService.export()`:
   - main's folder dialog; a cancel returns null;
   - writes `apiary-export-<date>/` containing `digests.json` (from `KnowledgeStore`),
     `residents/<id>/{history,notes}.json`, `settings.json` with the Slack token absent (it is not
     in settings anyway), and `README.txt` describing each file;
   - files are mode 0600 and the directory 0700.

**Verification.**

```sh
npm run typecheck && npm run lint
npm test -- tests/unit/redactPrivacy.test.ts tests/unit/redact.test.ts tests/unit/privacy tests/unit/logger.test.ts
npm run test:integration -- tests/integration/knowledgeForget.test.ts tests/integration/removeSessionErases.test.ts
npm test -- tests/unit/architecture   # persistedStores, confine, no-raw-state-write
```

---

#### Subagent D: Settings Privacy UI and Consent Dialogs

**Files.**

- Create:
  - `src/renderer/features/settings/sections/PrivacySection.tsx`;
  - `src/renderer/features/settings/sections/PrivacyConsentDialog.tsx`;
  - `src/renderer/features/settings/sections/PurgeDialog.tsx`;
  - `src/renderer/state/privacyStore.ts` (`createIpcStore` on `privacyStatus` and
    `privacyChanged`), plus commands `grantPrivacy`, `revokePrivacy`, `setStrictMode`,
    `purgePrivacyData`, `exportPrivacyData`;
  - `src/renderer/styles/` additions in a new `NN-privacy.css`, using tokens only;
  - `tests/component/privacySection.test.tsx`;
  - `tests/component/ui/privacy.ui.test.tsx` (UI scenarios: strict on and empty; migrated
    consents; off-confirmation dialog; purge dialog; purge result with a failure; narrow width;
    Glass theme).
- Modify:
  - the settings nav and section registry, where `settings-nav-${id}` is built (add `privacy`
    between `general` and `accounts`), and the settings search index for the new section;
  - `src/renderer/features/settings/sections/ResidentCardFields.tsx` (a "Digest paused: needs your
    OK" or "Cycle paused" line with a link to Privacy);
  - `src/renderer/features/settings/sections/SlackSection.tsx` (the status sentence for consent,
    and the disclosure line "Session progress is posted to the channel");
  - `src/renderer/features/settings/sections/DiagnosticsSection.tsx` (the "kept at most 7 days in
    privacy mode" hint).

**Spec.**

1. **The Privacy section** (`privacy-section`):
   - **Strict-mode switch** (`privacy-strict`, role switch, "Privacy mode (recommended)"). Turning
     it off opens `PrivacyConsentDialog` in "all" mode, listing every not-yet-consented
     disclosure. Cancel is the default and focused button. Confirm calls
     `setStrictMode(false)`.
   - **"What leaves this machine"** (`privacy-recipients`): one row per `PrivacyFeature`
     (`privacy-row-<feature>`), with the recipient, what is sent, when, the consent state ("Allowed
     on 25 Nov 2026", "Allowed — you had it on before privacy mode", "Not allowed") and an
     Allow/Withdraw button (`privacy-allow-<feature>`, `privacy-withdraw-<feature>`).
     - Allow opens `PrivacyConsentDialog` for that one feature.
     - Withdraw opens a small confirm with the checkbox "Also delete what it produced"
       (`privacy-withdraw-purge`).
   - **Always-listed rows that strict mode does not gate:**
     - Claude usage meter: shows the ADR-0019 consent and links to the plugin setting;
     - update checks;
     - your own `claude` sessions (Anthropic; user-initiated).
   - **Retention** (`privacy-retention`): a number input for `dataRetentionDays`, saved through
     `saveInstantSetting`, with a hint listing what it applies to.
   - **Data:**
     - "Purge Apiary indexes, digests and logs…" (`privacy-purge`) opens `PurgeDialog`;
     - "Export my Apiary data…" (`privacy-export`).
2. **`PrivacyConsentDialog`** (`privacy-consent-dialog`):
   - title "Allow <feature label>?";
   - body: the `PRIVACY_DISCLOSURES` text verbatim, plus for `backgroundDigest` "This covers
     sessions from the last <lookback>; change it on Regent's card.";
   - buttons `privacy-consent-cancel` (default) and `privacy-consent-allow`;
   - wrapped in `DialogBoundary`.
3. **`PurgeDialog`** (`privacy-purge-dialog`):
   - checkboxes per `PurgeRequest` key, all checked except `sessionMetadata`;
   - the line "Your Claude Code transcripts in ~/.claude are not touched.";
   - the confirm button `privacy-purge-confirm` is disabled until at least one box is checked;
   - the result view (`privacy-purge-result`) shows the freed size and each failure.
4. Rules:
   - every write goes through `state/`; components never touch `window.apiary` (`bridge-via-state`);
   - focus uses `focusAskedFor` for the dialogs' default button;
   - no `autoFocus`; icons come from `ui/`.
5. In a remote window this section edits the **work machine's** consents (machine scope); show the
   existing `settings-machine-switch` hint.

**Verification.**

```sh
npm run typecheck && npm run lint
npm run test:component -- tests/component/privacySection.test.tsx tests/component/ui/privacy.ui.test.tsx tests/component/residentsSettings.test.tsx
npm run ui:review    # look at every privacy screenshot against .claude/skills/ui-review/SKILL.md
```

---

#### Subagent E: Cross-cutting Integration, E2E, Docs and the Feature Map

**Files.**

- Create:
  - `tests/integration/privacy/strictModeEndToEnd.test.ts`;
  - `docs/adr/0023-gdpr-strict-mode-and-per-feature-consent.md`;
  - `.claude/skills/verify-apiary/features/privacy.md`.
- Modify:
  - `tests/e2e/settings.spec.ts`: add the privacy case **inside an existing test**. The e2e budget
    (`tests/e2e/budget.json`) must not grow;
  - `docs/environment.md` (the userData table: `logs/.salt`, the retention note);
  - `docs/slack.md` (the outbound disclosure and the consent step);
  - `docs/adr/README.md`;
  - `.claude/skills/verify-apiary/features/README.md`, `settings.md`, `residents.md`, `slack.md`;
  - the root `CLAUDE.md` rule table: one row, "Automatic processing that sends data off the machine
    goes through `PrivacyGate`", enforced by the test below;
  - `tests/unit/architecture/privacyGated.test.ts` (new): every `claude` one-shot or cycle start
    site, `SlackBridge.start` and `gitlabMr` exec is reached only through a `gate.allows` check.
    Use a source scan with a shrink-only allowlist that starts **empty**.

**Spec.**

1. Integration (real services, fake `claude` and `fakeSlack`), on a fresh userData:
   - Regent enabled → no digest call, Slack poll or cycle until the matching grant; after a grant
     each starts within one reconcile; after a revoke none sends again;
   - strict off → all run with no consents.
2. Migration integration: a v3 `settings.json` with Regent enabled plus a `slack.json` with
   `enabled: true` gives strict on, `backgroundDigest`, `residentCycles` and `slackBridge` all
   `migrated`, with no interruption of the digest.
3. Erasure integration:
   - `removeSession` → the session's chunks are gone from `search.db` and its rows from
     `knowledge.db`;
   - purge all → the userData stores are empty, and a sentinel file under a fake Claude config root
     still exists.
4. E2E, inside the existing settings test:
   - open Settings → Privacy, and see strict on;
   - turn it off: the dialog lists the disclosures; cancel, and it is still on;
   - Purge → result shown;
   - `settings.json` holds `gdprStrictMode: true`.
5. ADR-0023 states the decision, the rejected alternative (a single global consent, rejected
   because Art. 7 requires granularity) and the check that enforces it (`privacyGated.test.ts`).
6. Run `maintain-verify-apiary`'s live drive for the new section (`drives/local/`), and promote it
   if it is worth rerunning.

**Verification.**

```sh
npm run typecheck && npm run lint
npm test && npm run test:integration
npm run test:component
npm run build && npx playwright test tests/e2e/settings.spec.ts --project=parallel --no-deps
npm run test:e2e:smoke
npm run lint:md    # doc references resolve
```

### File ownership matrix

"A, then X" means A makes the one-line type or wiring change first and X owns the file after A
merges.

| File or folder | A | B | C | D | E |
| --- | --- | --- | --- | --- | --- |
| `shared/domain/privacy.ts`, `shared/settings/schema.ts`, `main/settings.ts`, `shared/ipc/contract.ts`, `main/ipc/*`, `main/remote/scopes.ts` | ✔ | | | | |
| `main/app/container.ts`, `main/plugins/pluginService.ts` | ✔ | | | | |
| `main/app/{residents,knowledge}Container.ts` | ✔ (type field only) | | | | |
| `main/app/slackContainer.ts` | A, then B | ✔ | | | |
| `main/app/privacyContainer.ts` | A (stub), then C | | ✔ | | |
| `main/privacy/privacyGate.ts`, `types.ts` | ✔ | | | | |
| `main/privacy/{retentionSweeper,purgeService,exportService}.ts` | | | ✔ | | |
| `main/residents/{residentService,quickActions,cycle,kinds}.ts`, `shared/settings/residents.ts`, `shared/domain/residents.ts` | | ✔ | | | |
| `main/residents/residentSpace.ts` | | | ✔ | | |
| `main/knowledge/digester.ts` | | ✔ | | | |
| `main/knowledge/knowledgeStore.ts` | | | ✔ | | |
| `main/slack/{slackBridge,slackStore}.ts` | | ✔ | | | |
| `main/slack/slackTasks.ts` | | | ✔ | | |
| `main/plugins/gitlabMr.ts`, `main/spelling/spellingService.ts` | | ✔ | | | |
| `shared/redact.ts`, `main/log/*` | | | ✔ | | |
| `main/search/{indexer,searchService}.ts`, `main/sessions/sessionActions.ts`, `main/media/imageStore.ts`, `main/schedule/scheduledJobs.ts` | | | ✔ | | |
| `renderer/**`, `tests/component/**` (except the fake) | | | | ✔ | |
| `tests/component/fake/privacy.ts`, `tests/contract/clauses/privacy.ts` | ✔ | | | | |
| `tests/integration/privacy/**`, `tests/e2e/settings.spec.ts`, `tests/unit/architecture/privacyGated.test.ts`, `docs/**`, `.claude/skills/verify-apiary/**`, root `CLAUDE.md` | | | | | ✔ |
| `package.json`, `package-lock.json`, `CHANGELOG.md` | lead only, at merge | | | | |

### Order and merge checklist

1. A: review, run the Stop hook, `trim-comments`, then merge. The lead bumps a minor version for the
   settings migration.
2. B, C and D in parallel, from the post-A branch. Merge each with `--no-ff`; after each run
   `npm run typecheck && npm run lint && npm test`; the lead bumps the version.
3. E last. It rebases on B, C and D, and its integration tests exercise all three. Run the full
   `npm run test:e2e` before any tag (the pre-push hook does this anyway).
4. Before release:
   - `npm run release -- --check`;
   - fold in open issues, nightlies and Dependabot PRs;
   - ask the maintainer before pushing or tagging.
