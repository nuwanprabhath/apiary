# Knowledge

Read with root CLAUDE.md and [src/main/search/CLAUDE.md](../search/CLAUDE.md); this covers what the
residents search: refs, topic digests, and how a question is turned into sessions. Design:
`docs/superpowers/specs/2026-10-30-regent-and-tab-list-design.md` §2.3.

**Refs live in the search DB, digests in their own.** `refs.ts` is pure and free, so its rows
(`refs(session_id, kind, value)`) are written by the search indexer in the same transaction as the
session's chunks and cleared with them; a search rebuild loses nothing it cannot recompute in
seconds. A digest costs the user's quota, so `knowledge.db` (`KnowledgeStore`) is never touched by
a search rebuild; only Settings' re-digest (`Digester.reset`) clears it. A pasted MR or ticket link
becomes the same refs as the `!1175` the transcript wrote (`refsInQuery`), so the lookup is an
exact indexed match and the sidebar search uses it too.

**The digester is incremental by line.** `digested.last_line` is the last transcript line already
read; a grown session is read only after it, and a session whose file size equals `digested.size`
is skipped without being opened. Progress is recorded after every window (about 40k characters of
user and assistant text, tool names only), with `size` 0 until the whole file is done, so a pause
or a crash costs one window and the next pass resumes from `last_line`. Newest sessions first, and
only those last active inside `resume`'s `lookback` (null: all), which also bounds `progress().total`. One
model call at a time; `shouldPause()` is checked before each call and re-checked every minute while
true. A failed session gets `failed_at` and is not retried for 24 hours. `resume` is a no-op while
a pass runs, and the pass ends when the queue does: the schedule calls `resume` again.

**Exclusions.** A session whose `cwd` is inside the residents folder (`ContainerPaths.residentsDir`) is a resident's own chat and
is never digested or listed as a result of digesting; otherwise a resident would index itself.

**The account rule.** The digest call is a `claude` Apiary starts, so it runs under the default
account (`accounts.launchEnv(accounts.defaultId())` as the one-shot's `env`), like a theme or a
pet; the usage it spends is that account's. See `tests/unit/architecture/claudeStartsWithAccount.test.ts`.

**Ranking** (`KnowledgeService.find`): exact refs, then digest topics, then transcript text, then
titles, branches and folders; a session appears once, at its best tier. Every query goes through
`toMatchQuery`. Topics are the one place a no-match query is retried with OR between the words,
because a person describes a topic in words only some of which the digest used.
