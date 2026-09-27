# Search

Read with root CLAUDE.md; this covers the FTS5 index, tokenisation and the search worker. See also
[src/renderer/state/CLAUDE.md](../../renderer/state/CLAUDE.md) for the renderer-side filtering that
never touches this index.

`src/main/search/` keeps an FTS5 index in a database of its own, because it is derived data that can
always be rebuilt from the JSONL. **Tokenisation is the whole design**: punctuation is split on
rather than kept, so `!1257` and `1257` find the same session, and `2260-remove-prefill` matches both
whole and by any word in it. Adding `-` or `!` to `tokenchars` would make each of those one
indivisible token and break every partial search anyone would type. User queries go through
`toMatchQuery`, which reduces them the same way — typed raw into `MATCH`, `!1257` is a syntax error,
not a search.

Notes live in a second FTS table in the same file, deliberately apart from the transcript chunks.
A note is written by hand and changes on its own schedule, while `chunks` is keyed to a
transcript's size and mtime — folding the two together would mean either re-reading a whole JSONL
to record a one-line note, or a freshness check that no longer describes what it covers. Keeping
them apart is also what lets the two settings be independent, and what makes a note searchable the
instant it is saved. The notes themselves belong to the *session store*: they are the one thing
here that cannot be rebuilt from `~/.claude/projects`.

**The content search runs in a worker thread** (`searchWorker.ts`, driven by `searchClient.ts`).
`better-sqlite3` is synchronous, so running an FTS query inline put it on the same thread that
routes window input — and a slow query therefore froze *typing in every window*, not merely the
results. That shipped: a one-character query measured 7.7 seconds on a real library, and the
keystrokes typed during it arrived afterwards in a single burst while the renderer sat idle. It was
diagnosed as a rendering problem twice before anyone measured the main process. If the worker
cannot start, the search falls back to running in-process and logs it — `SearchClient.search`
returns `null` rather than `[]`, because "the search never ran" and "nothing matched" are opposite
answers and conflating them shows an empty sidebar as if it were a result.

**A prefix term needs three characters** (`MIN_PREFIX_CHARS`). FTS5 walks every token in the index
beginning with a prefix, so the cost is inversely proportional to how much has been typed and the
first letter is the most expensive query the index can be asked. Below three characters the token
is searched exactly; titles, paths and branches are filtered in the renderer against a cached tree,
so a short query still narrows the sidebar instantly.

Indexing is incremental (unchanged files are skipped by size and mtime without being opened) and
yields between files. It is deliberately *not* a worker thread: the renderer is already a separate
process, so indexing cannot freeze the UI, and yielding costs far less than a second bundled entry
point would.
