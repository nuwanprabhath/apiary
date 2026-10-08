# Architecture decision records

Short records for decisions where an alternative was tried (or seriously considered) and rejected —
the content most at risk of being "helpfully" re-proposed by someone who wasn't there for the first
attempt. Use [`template.md`](template.md) for a new one; every ADR ends its body with an "Enforced by:" line naming the check that fails when the decision is broken. Topic docs and nested `CLAUDE.md` files
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
| [0011](0011-sanctioned-ways-with-shrink-only-baselines.md) | One sanctioned way per task, checked by a rule, with baselines that only shrink |
| [0012](0012-one-versioned-json-store.md) | Every persisted JSON file goes through one versioned `JsonStore` |
| [0013](0013-renderer-data-layer-stores-and-commands.md) | The renderer reads through `createIpcStore` stores and acts through commands with one error policy |
| [0014](0014-one-composition-root-and-appservice-facade.md) | One composition root builds every long-lived object; `AppService` stays a facade |
| [0015](0015-chat-state-delivered-per-window.md) | Chat state goes only to the windows that show it; lifecycle goes to all |
| [0016](0016-no-end-of-options-for-git-checkout.md) | Refs are checked with `assertNotOption` and `--`, never `--end-of-options` |
| [0017](0017-chat-defaults-to-auto-permission-mode.md) | A chat starts in `auto` permission mode unless Claude Code's settings choose one |
| [0018](0018-pets-render-cache-in-indexeddb.md) | Pet renders are cached in IndexedDB, a second renderer persistence |
| [0019](0019-claude-usage-asks-before-reading-the-token.md) | The Claude usage plugin asks once before it reads Claude Code's token |
