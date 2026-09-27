# ADR-0003: Paths come out of git via `--porcelain`, never a parsed error message

- **Status:** Accepted
- **Context:** Some git operations (checking out a branch already held by another worktree) fail
  with a human-readable error that happens to name the path we need — the worktree already holding
  that branch.
- **Decision:** Any path that has to come out of git is read from a machine-readable, porcelain
  output (`git worktree list --porcelain`), never parsed out of git's English, quoted error text.
- **Alternatives tried:** Parsing the error string was the obvious shortcut and was rejected before
  shipping, specifically because git's plain-text error strings are not a stable contract — they
  change across git versions and locales — and because it would have broken ADR-0001: the resulting
  path would not be one the main process derived itself from a trusted, structured source.
- **Consequences:** A new "resolve a path from git" need reaches for `--porcelain` (or an
  equivalent structured flag) first, not `git`'s default human-readable output.

See [`docs/architecture/boundaries.md`](../architecture/boundaries.md) for the full story.
