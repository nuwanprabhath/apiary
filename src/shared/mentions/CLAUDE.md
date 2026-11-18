# src/shared/mentions — what a message's prose mentions

Read with root CLAUDE.md. Pure code, used by the renderer (`ui/message/mentionMarkup.ts`) and main
(`main/git/gitService.ts`).

- **No model is involved.** Claude writes references the way the forge spells them (`#3202`,
  `!1713`); Apiary links them when it draws the text, from the session's `origin` remote. There
  is no system prompt for it, and none is needed.
- **The registry.** `MENTION_KINDS` (`kinds.ts`) is a `Record` of `MentionKind`s: a global
  `pattern` and a `resolve(match, context)` that returns a target (`{ kind: 'link', href }` or
  `{ kind: 'file', text }`) or null when this context has none. `findMentions` runs every kind over
  one prose text node, drops matches inside a URL, and keeps the longest match where two overlap
  (a project-qualified `#12` over the bare one). Code blocks, inline code and existing links never reach it
  (`markMentions` skips them).
- **Context.** `MentionContext` is `{ repo, files }`: `repo` is a `RepoWebLocation` main works out
  from `git remote get-url origin` (`parseRepoWebLocation`, `repoWebLocation` IPC, cached per
  folder against the repository `config` mtime); `files` is whether VS Code can open a file. The
  MR Desk popup's context is its configured project (`gitlabProjectWebLocation`). No context, no
  reference links.
- **Patterns guard their edges.** `REF_BEFORE`/`REF_AFTER`: never glued to a word, a path, a query
  or another reference; `#N` is digits only, so `#heading` and `#fff` are not references, and a
  six-digit `#N` after `property:` is a colour.
- **Adding a kind** (a Jira key, a commit sha): one entry in `MENTION_KINDS` with a test in
  `tests/unit/mentions.test.ts`. Its `href` must be built from the context, never copied from the
  text beyond the matched id, since it becomes a real link.
- **User-defined kinds, later.** `findMentions` takes `extra`, a record of further kinds. A
  Settings list of `{ pattern, urlTemplate }` (a Jira key pattern and the Jira browse URL with `$0`)
  becomes kinds there: the pattern compiled with the `g` flag, `resolve` filling `$0`/`$1` from the
  match. Not built yet: no setting, no UI.
