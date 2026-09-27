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
