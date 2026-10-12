# Feature map

One file per user-facing feature. Each says what the feature is, how a user reaches it, how to
drive it with `launchApiary`, and what end state proves it works. Test ids come from the e2e spec
named in each file; when one stops matching, that spec is the place to look first.

| Feature | File | e2e spec it mirrors | Shipped drive |
| --- | --- | --- | --- |
| Sessions sidebar and search | [sessions-and-search.md](sessions-and-search.md) | `sidebar.spec.ts`, `search.spec.ts`, `pinning.spec.ts` | `doctor` (boot and list only), `release-1-39` (pin from the menu) |
| Panes, tabs and terminals | [panes-and-terminal.md](panes-and-terminal.md) | `paneLayouts.spec.ts`, `terminal.spec.ts` | `release-1-39` (the toggle, the one-row header) |
| Transcript chat | [transcript-chat.md](transcript-chat.md) | `transcriptChat.spec.ts` | `release-1-39` (message times, folding the box) |
| Settings | [settings.md](settings.md) | `settings.spec.ts` | none |
| Themes | [themes.md](themes.md) | `themes.spec.ts` | none |
| Pets | [pets.md](pets.md) | `pets.spec.ts` | `pets` |
