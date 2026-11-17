# Feature map

One file per user-facing feature. Each says what the feature is, how a user reaches it, how to
drive it with `launchApiary`, and what end state proves it works. Test ids come from the e2e spec
named in each file; when one stops matching, that spec is the place to look first.

| Feature | File | e2e spec it mirrors | Shipped drive |
| --- | --- | --- | --- |
| Sessions sidebar and search | [sessions-and-search.md](sessions-and-search.md) | `sidebar.spec.ts`, `search.spec.ts`, `pinning.spec.ts` | `doctor` (boot and list only), `release-1-39` (pin from the menu), `features` (search, pin, the Active section, the row menu) |
| Panes, tabs and terminals | [panes-and-terminal.md](panes-and-terminal.md) | `paneLayouts.spec.ts`, `terminal.spec.ts` | `release-1-39` (the toggle, the one-row header), `features` (a shell, a layout preset) |
| Transcript chat | [transcript-chat.md](transcript-chat.md) | `transcriptChat.spec.ts` | `release-1-39` (message times, folding the box), `features` (a background task, the "/" actions) |
| Settings | [settings.md](settings.md) | `settings.spec.ts` | `features` (settings search, themes, accounts) |
| Themes | [themes.md](themes.md) | `themes.spec.ts` | none |
| Pets | [pets.md](pets.md) | `pets.spec.ts` | `pets` |
| Resident agents | [residents.md](residents.md) | `residents.spec.ts`, `regent.spec.ts` | `features` (the Regent popup) |
| Scheduled messages | [schedule.md](schedule.md) | `live/scheduledMessage.spec.ts` (opt-in) | `features` (the dialog from "/") |
| Claude accounts | [accounts.md](accounts.md) | `accounts.spec.ts` | `features` (add an account) |
| Status bar and usage | [status-bar.md](status-bar.md) | `statusBar.spec.ts` | `features` (usage consent) |
| Remote windows | [remote.md](remote.md) | `tests/remote/` (Docker) | `features` (the dialog only) |
