# Architecture docs

Cross-cutting topics that span main, shared and renderer, split out of the old monolithic
`CLAUDE.md` (see [ADR-0004](../adr/0004-claude-md-restructure.md)). Root `CLAUDE.md` is always
loaded; these and the nested `CLAUDE.md` files below load only when relevant.

| Topic | Doc |
| --- | --- |
| Multi-window ownership, relaunch persistence, tab registry | [windows-and-tabs.md](windows-and-tabs.md) |
| Activity status (running/waiting/idle/stopped) classification | [activity.md](activity.md) |
| Which Claude session a terminal is on | [session-following.md](session-following.md) |
| The three trust-boundary rules, in full | [boundaries.md](boundaries.md) |

Non-architecture cross-cutting docs, one level up:

| Topic | Doc |
| --- | --- |
| Why the native-module ABI trap no longer applies | [../testing.md](../testing.md) |
| `ELECTRON_RUN_AS_NODE` and "measure before fixing" | [../debugging.md](../debugging.md) |
| Build/packaging internals (not in the user README) | [../packaging.md](../packaging.md) |
| Lightweight ADRs for decisions with a rejected alternative | [../adr/](../adr/) |
| Historical specs and plans (code wins on conflict) | [../history/](../history/) |

Nested `CLAUDE.md` files, for reference (each loads automatically when Claude Code reads a file in
its directory — see root `CLAUDE.md`'s "Where the long-form lives"):

`src/main/CLAUDE.md`, `src/main/pty/CLAUDE.md`, `src/main/search/CLAUDE.md`,
`src/main/store/CLAUDE.md`, `src/main/update/CLAUDE.md`, `src/main/plugins/CLAUDE.md`,
`src/main/log/CLAUDE.md`, `src/renderer/CLAUDE.md`, `src/renderer/state/CLAUDE.md`,
`src/shared/theme/CLAUDE.md`, `tests/CLAUDE.md`.
