# Boundaries: what the renderer is never trusted with

The full prose behind root CLAUDE.md's three hard rules about trust boundaries. See also
[ADR-0001](../adr/0001-renderer-never-supplies-a-path.md).

## The renderer never supplies a filesystem path

Anything that reaches a shell or a spawn is resolved in the main process from an id it already
trusts (`resolveShellCwd`, `buildResumeCommand`'s UUID check, `readImage`'s confinement to its own
directory). Keep it that way. A path typed or dragged in the renderer is not proof of anything —
the renderer is untrusted input the moment it crosses the IPC boundary, and the main process is
the only side allowed to decide what a session id or a tab key actually resolves to on disk.

## Working directories come from the JSONL, never the directory name

Working directories come from the `cwd` field inside a session's JSONL, never from the directory
name under `~/.claude/projects`, which is a lossy encoding of the path (slashes become dashes, and
two different real paths can collide on the same encoded name). Anything that derives a cwd from
the folder name instead of reading the JSONL will eventually resolve to the wrong project.

## Git's prose is not an interface

Where a path has to come out of a git failure — the worktree holding a branch you tried to check
out — it is looked up with `git worktree list --porcelain`, not parsed out of the English, quoted
error message. Git's plain-text error strings are not a stable contract (they change across git
versions and locales), and parsing one to extract a path would also violate the rule above: the
path the app then acts on has to be one the main process derived itself, from a command with a
machine-readable output format, not one it scraped out of prose meant for a human.

A ref that git might read as a flag is refused by `assertNotOption` in `src/main/git/branchOps.ts`
and the arguments end with `--`; `--end-of-options` is not used because git before 2.44 miscounts it
([ADR-0016](../adr/0016-no-end-of-options-for-git-checkout.md)).
