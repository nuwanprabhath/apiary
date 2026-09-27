# Architecture decision records

Short records for decisions where an alternative was tried (or seriously considered) and rejected —
the content most at risk of being "helpfully" re-proposed by someone who wasn't there for the first
attempt. Use [`template.md`](template.md) for a new one. Topic docs and nested `CLAUDE.md` files
describe *how things currently work*; an ADR records *why an alternative doesn't*, once, so the
topic doc doesn't have to repeat it.

| ADR | Decision |
| --- | --- |
| [0001](0001-renderer-never-supplies-a-path.md) | The renderer never supplies a filesystem path |
| [0002](0002-cwd-always-from-session-jsonl.md) | A session's cwd always comes from its JSONL |
| [0003](0003-git-porcelain-not-prose.md) | Paths from git come via `--porcelain`, never parsed prose |
| [0004](0004-claude-md-restructure.md) | CLAUDE.md: short root plus co-located docs |
| [0005](0005-no-backdrop-filter.md) | No `backdrop-filter`, anywhere, in glass themes |
| [0006](0006-search-runs-in-worker-thread.md) | Content search runs in a worker thread |
| [0007](0007-gitlab-plugin-shells-out-to-glab.md) | GitLab plugin shells out to `glab`, not the API |
| [0008](0008-layout-presets-not-split-tree.md) | Window layouts are a preset table, not a split tree |
| [0009](0009-prompt-dirtrim-not-ps1-rewrite.md) | Shorten bash's prompt with `PROMPT_DIRTRIM`, not `PS1` |
| [0010](0010-unsigned-macos-build-cannot-self-update.md) | Unsigned macOS build downloads+opens, never self-installs |
