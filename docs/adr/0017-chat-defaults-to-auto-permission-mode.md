# ADR-0017: A chat starts in `auto` permission mode unless Claude Code's own settings choose one

- **Status:** Accepted (the current decision, recorded as found)
- **Context:** A chat started in Manual, so Claude asked before every tool call, unless a mode was
  picked in the message box before sending. `src/main/chat/startMode.ts` and the CHANGELOG (1.31.14,
  "A chat starts in Auto") record the change. A terminal session keeps `claude`'s own default; the
  chat default is therefore different from the terminal's.
- **Decision:** `chatStartMode(configRoot, cwd)` returns `auto` when none of the user's settings
  (`<config>/settings.json`), the project's, or the project's local one (both under its `.claude`
  folder) sets `permissions.defaultMode`. When one does, nothing is passed and
  `claude` starts in that mode. A mode picked in the composer always wins.
- **Alternatives tried:** Manual, by leaving `claude` to its default (before 1.31.14): `claude` asked
  before every tool call. The CHANGELOG entry and the `startMode.ts` comment record the change, not a
  measurement of why Auto is better; the 2026-10-07 review calls it deliberate.
- **Consequences:** The change is visible to anyone who never set a default mode. A user who wants
  Manual sets `permissions.defaultMode` in Claude Code's settings or picks it per chat. The 2026-10-07
  review (§3) raises the permission card's focus behaviour separately; this decision does not depend on
  it. Do not change the default without a CHANGELOG entry that says so.
- **Enforced by:** `tests/integration/chatStartMode.test.ts` (auto with no setting; none passed when
  any of the three files sets a mode).

See [`src/main/chat/CLAUDE.md`](../../src/main/chat/CLAUDE.md).
