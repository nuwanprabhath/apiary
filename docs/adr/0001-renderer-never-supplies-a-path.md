# ADR-0001: The renderer never supplies a filesystem path

- **Status:** Accepted
- **Context:** Every IPC call that reaches a shell, a spawn, or the filesystem needs a working
  directory or file path from somewhere. The renderer already knows the session the user clicked.
- **Decision:** The renderer sends only opaque ids (a session id, a tab key). The main process
  resolves any path itself, from an id it already trusts — never from a string the renderer sent.
- **Alternatives tried:** None; this was decided up front, not walked back from an incident. It is
  listed as an ADR because it is the single most load-bearing security invariant in the app, and
  every new IPC call is a chance to accidentally reverse it.
- **Consequences:** `resolveShellCwd`, `buildResumeCommand`'s UUID check and `readImage`'s
  confinement to its own directory all exist to keep this true. A new handler that accepts a path
  argument from the renderer and uses it directly is a regression, not a feature.

See [`docs/architecture/boundaries.md`](../architecture/boundaries.md) for the full story.
