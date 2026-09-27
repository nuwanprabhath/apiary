# ADR-0006: Content search runs in a worker thread

- **Status:** Accepted
- **Context:** `better-sqlite3` is synchronous. Content search runs an FTS5 `MATCH` query that can
  take seconds on a large library.
- **Decision:** `search/searchWorker.ts` runs the FTS5 query off the main thread; `searchClient.ts`
  drives it from `AppService`. If the worker cannot start, search falls back to running in-process
  and logs it, returning `null` (not `[]`) so "the search never ran" stays distinguishable from
  "nothing matched."
- **Alternatives tried:** Running the query inline on the main thread was the original
  implementation. Measured: a one-character query took 7.7 seconds on a real library, during which
  every window stopped responding to input — not just the search results, because the main thread
  also routes window input. It was misdiagnosed as a rendering problem twice before anyone measured
  where the time actually went.
- **Consequences:** A future change to the search query path must keep it off the main thread. The
  incremental indexer, by contrast, deliberately stays on the main thread (see
  `src/main/search/CLAUDE.md`) — that decision was not walked back from an incident and has no ADR.

See [`src/main/search/CLAUDE.md`](../../src/main/search/CLAUDE.md).
