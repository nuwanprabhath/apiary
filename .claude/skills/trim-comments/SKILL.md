---
name: trim-comments
description: Cut the comments in a diff (or a folder) down to the ones that carry a fact the code cannot, and flag the code whose surprise a comment was apologising for so it can be renamed, typed or reshaped. Adapted from pstack's no-comments. Use when reviewing an agent's branch before merging, when /correct finds a constraint written as prose, or when asked to clean comments.
---

# Trim comments

Every agent that opens a file in Apiary reads its comments, so a comment costs context in every
session that touches the file. In 1.44, a quarter of the lines in `src/main` and `src/shared` were
comments, and over 300 of them cited a version number or a review id. A comment earns its place only
by saying something a reader needs that the code, the test names and git cannot say.

Adapted from pstack's `no-comments` skill (MIT). The difference is the default: pstack deletes
whatever it cannot prove is a keep. Apiary keeps the reasons next to the code on purpose (root
`CLAUDE.md`), so a measured finding stays even when it is about our own code, and doubt is flagged
for the lead rather than deleted.

## When it runs (automatic, nobody invokes it by hand)

- **Every agent branch, before the lead merges it.** `agent-orchestration` makes it a review step:
  spawn the trimmer on the branch's diff and apply what survives your review.
- **Every `/correct`**: a constraint written as prose ("never…", "do not remove…") is a rule nothing
  enforces. `/correct` moves it to a check and this skill deletes the prose.
- **Always, mechanically:** `tests/unit/architecture/commentHistory.test.ts` (part of `npm run lint`
  and the Stop hook) fails on an Apiary version or a review id in a source comment. That needs no
  judgment, so it is a check, not this skill.

## Scope

The caller's files, folder or diff. Default: the current branch's diff against its base, working
tree included. Source only (`src/`, `scripts/`, `eslint/`); test names and test comments are
statements about behaviour and are out of scope unless the caller names them.

## Steps

1. **Spawn the trimmer**: a subagent (Sonnet, or `run-agent.sh` in a worktree for a large scope)
   whose prompt is [`references/trimmer.md`](references/trimmer.md) verbatim, then the scope. It
   edits comments only and reports.
2. **Review its diff, every hunk.** Reject: any change to code (not a comment); a deletion of a
   keep (see the reference's list) — restore it; a comment rewritten into a different claim; a
   flag naming code outside the scope. When unsure whether a deleted comment held a measured fact,
   check `git log -S'<phrase>'` for the commit that added it: a commit that fixed a bug the comment
   describes means keep it, shortened to the fact.
3. **Act on `RESHAPE` flags.** Trivial ones (a rename, a narrower type, extracting a named
   function) in the same change. Ones that need design go to the report as open work.
4. **Constraint comments** become checks via `/correct` when a check is possible in scope; the
   comment then goes. Otherwise the comment stays and the report lists it as unenforced.
5. **Verify**: `npm run typecheck && npm run lint` (comments can carry `eslint-disable` reasons and
   doc references `check-doc-refs` reads), and the tests of any file whose code changed.
6. **Report**: comment lines removed, restorations, reshapes done, reshapes open, constraints
   enforced or left in prose.
