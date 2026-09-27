# ADR-0002: A session's working directory always comes from its JSONL

- **Status:** Accepted
- **Context:** Claude Code stores each project's sessions under a directory name derived from the
  real path (slashes become dashes). That name is easy to reach for as a "working directory," but
  it is a lossy encoding — it cannot always be reversed back to the original path.
- **Decision:** The working directory is always read from the `cwd` field inside the session's own
  JSONL, never derived from the directory name under `~/.claude/projects`.
- **Alternatives tried:** Deriving the path from the directory name was the original approach, and
  was replaced once the encoding's lossiness was understood — a directory name collision between
  two different real paths would have silently resolved sessions to the wrong project.
- **Consequences:** Anything that needs "where does this session run" reads the JSONL, not the
  folder name. A scanner or importer that takes a shortcut through the directory name will resolve
  to the wrong project on any path with the encoding's collision cases.

See [`docs/architecture/boundaries.md`](../architecture/boundaries.md) for the full story.
