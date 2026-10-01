# Session-bar plugins

Read with root CLAUDE.md; this covers the plugin registry, its settings fields and the GitLab
plugin. See also root CLAUDE.md's "How to add… a plugin" recipe.

`src/main/plugins/` lets things contribute a button to the bar under a session without the bar
knowing what they are. A plugin answers one question — given this folder and this branch, what
would you put on the bar? — and the answer is *data*: an icon chosen from a fixed set the renderer
knows how to draw (`PluginIcon`, `src/shared/domain/plugins.ts` — the single definition; the
renderer imports the same type rather than a hand-mirrored copy), a label, and an action from a
closed list (today, "open this URL"). No markup crosses the boundary, so a plugin cannot put
arbitrary content in the window, and the URL is re-checked in the main process before
`shell.openExternal` sees it.

**The context carries the folder's remote, so a plugin never shells out to git itself.**
`PluginContext` is `{ cwd, branch, remoteUrl() }`; `remoteUrl()` resolves the `origin` URL (or
null) and the registry memoises it for one evaluation, so two plugins on one folder spawn
`git remote get-url` once. Plugins still return data only — the context is an input, not a
capability to act. The built-in GitLab plugin asks `ctx.remoteUrl()` and parses it with
`parseGitLabRemote`. Code that resolves inline references (the `!123` badge,
`GitService.mrRefStatus`) uses the same seam outside a plugin: `resolveRemote(cwd, parse)` in
`plugins/remote.ts`, with the provider's parser. A GitHub plugin or `#123` resolver is a new parser
plus a plugin file, with no new git calls.

Two things the registry guarantees, both learned from what the bar is for:

- **A plugin that throws contributes nothing and disturbs nothing else.** The bar carries git state
  that matters; an integration failing to reach its API must not take that with it.
- **A plugin is never on the render path.** The bar redraws on every git-status poll. Results are
  cached per folder+branch and refreshed in the background, with a stale answer served meanwhile,
  so a network call cannot decide how fast switching sessions feels.

**Plugins declare their settings too**, in the same declarative spirit: a plugin lists fields
(kind, key, label, help, default) and the Plugins section of Settings draws them, storing values
namespaced under `pluginSettings[pluginId]`. Nothing in the settings dialog knows what a field
means, so a new plugin needs no changes there — only a new *kind* of field does. Changing a value
recomputes what is cached in place rather than clearing it: clearing blanks the bar until the
lookup lands, and during that gap the window still holds the answer computed under the old setting,
which is a click on a button that does the thing you just changed.

The GitLab plugin shells out to **`glab`** rather than calling the API. Talking to the API means
holding a token, which means storing a credential, offering a field to paste it into, keeping it
out of settings backups, and explaining what scope it needs — all of which `glab` has already
solved, including for self-hosted instances. The consequence worth remembering: Apiary never sees a
GitLab credential, and the feature's setup instruction is `glab auth login`. The half that needs no
API (offering to create an MR) is built from the git remote alone, so it survives `glab` being
absent.

## Status-bar plugins (`src/main/statusBar/`)

A second kind of plugin, for the bar along the bottom of the window — the VS Code status bar
equivalent. A session-bar plugin is asked about one folder and branch; a status-bar plugin is about
the whole app, keeps its own schedule between `start()` and `stop()`, and answers `items()`
synchronously from what it last learned (`StatusBarRegistry`, same fault containment as above).
The same rule holds: everything is data (`src/shared/domain/statusBar.ts`) — an item's text, tone
and icon from a closed set, and its hover detail and dashboard as typed sections (table, gauges,
stacked bars, line, note) that `features/statusBar/StatusSections.tsx` draws. A new kind of content
is a new section kind, drawn once there, never markup from a plugin.

Both kinds share Settings → Plugins: `AppService.listPlugins()` lists both, and enabling or
settings route to whichever registry owns the id. A new status-bar plugin is one factory in
`statusBar/builtin.ts`.

The first is **Claude usage** (`statusBar/claudeUsage/`), a port of the claude-usage-stats VS Code
extension: the OAuth token Claude Code keeps (macOS Keychain, then `<config>/.credentials.json`)
is sent only to Anthropic's usage endpoint and never logged; token and cost totals come from the
transcripts. **The Keychain is read only when Apiary uses the real config root** — a Keychain read
can put a macOS permission prompt on screen, so the test harness's fixture home never triggers one.
`AppService` builds the registry but does not start it; `index.ts` calls `startStatusBar()`, so
constructing an `AppService` in a test never starts a network poll.
