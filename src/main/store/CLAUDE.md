# The store, and the cwd override column

Read with root CLAUDE.md; this covers `sessionStore.ts` and `schema.ts`.

The `session` table has a `cwd_override` column (`schema.ts`), set only by `recordSessionMove()`
when a session is dragged onto another worktree — it is how the session's effective working
directory changes without touching the JSONL, which still says where the session actually started.
`toSession()` reads it as `cwd_override ?? cwd`, so an override always wins when present.

**A rescan never writes `cwd_override` or `project_path`.** The scanner's `syncSessions()` upsert
deliberately omits both columns from its column list and its `ON CONFLICT` clause — a rescan can
update everything else about a session but can never touch either column. This has to stay true:
the JSONL's own recorded `cwd` never changes, so if a rescan ever wrote that column again, the next
filesystem scan after a move would quietly revert it back to the original folder.
