# Apiary

One desktop app for every Claude Code session on your machine: find any conversation in seconds,
pick it up where it left off, and work on several side by side, even on another computer.

![Apiary in its default Liquid Glass theme: a searchable sidebar with an Active section listing open sessions, Pinned and grouped sessions below it, and three sessions arranged in a layout on the right — a live Claude Code session in the large pane, two transcripts stacked beside it, and a shell with a minimal `$` prompt running under the live one — with three fuzzy pets on the status bar along the bottom](docs/screenshot.png)

## Why Apiary

- **Every session in one place.** Apiary reads the session files Claude Code already writes, groups
  them by the folder they started in and nests git worktrees under their repository. There is
  nothing to set up and nothing copied.
- **Find it again.** Fuzzy search over titles and your own notes, plus Pinned, Active and Recent
  lists, so last month's session is a few keystrokes away.
- **Pick up where you left off.** Resume any session in its own working directory, in a terminal or
  as a chat. Both drive the same `claude --resume`, so the transcript stays the one record.
- **Several at once.** Tabs, layouts of up to four panes, windows of their own, and a shell beside
  every session.
- **Your work machine, from home.** Open the Apiary on another computer over SSH or Tailscale, the
  way VS Code Remote-SSH works: its sessions, terminals and chats in a window here. Nothing
  listens on the network.
- **Git where the session is.** Branch, pull, push and the merge request for each session's own
  folder, without leaving it.

## Features

- **Import on your terms:** nothing appears until you import it; a ticked folder brings in new
  sessions on its own.
- **Transcripts** rendered as markdown, tool calls folded away, images inline.
- **Chat** with a session while it works, with pasted or dropped images.
- **Start, fork, rename, note, pin, hide** a session, or drag it to another worktree.
- **Git toolbar** per session: branch switcher, ahead and behind, pull, push, and help when a branch
  is checked out in another worktree.
- **GitLab merge requests** for the current branch, and their status beside `!1234` in titles,
  through `glab` (no token stored).
- **Remote access** over SSH: hosts from `~/.ssh/config`, recent connections and Tailscale;
  reconnects on its own; starts Apiary on the work machine if it is not running; optional pairing
  code.
- **Open in VS Code**, locally or over Remote-SSH from a remote window.
- **Themes**, including Liquid Glass, or describe one and Claude designs it.
- **Pets** (optional): small 3D characters on the status bar that react to what Claude is doing.
- **Remembers everything** across restarts: windows, layouts, tabs, and sessions that were running.
- **Keeps itself up to date** from GitHub releases.
- **Errors in plain words**, with the raw error a click away, and an opt-in diagnostic log that
  never records your conversations.

## Install

There's no signed installer yet, so the reliable way to get Apiary onto a
machine is to hand an AI coding agent with shell access (Claude Code, Cursor,
etc.) the install prompt:

**[docs/install-prompt.md](docs/install-prompt.md)** — open it and use the
file view's own copy button, then paste the whole thing into your agent.

It's kept as a file of its own, containing nothing but the prompt, precisely so
that copying it is one button rather than a careful drag across part of a page.

The prompt is written to be idempotent — running it again later checks the
installed version against the latest release and does nothing if you're
already up to date, or updates in place if you're not. If a GitHub release
exists for your platform it downloads the prebuilt artifact; otherwise (or if
none has been published yet) it builds from source instead, which always works
as long as the build requirements below are met.

## Requirements

To run a prebuilt release:

- macOS or Ubuntu 24.04
- `claude` on your `PATH`

To build from source, additionally:

- Node 22.22.1 or newer (see [CONTRIBUTING.md](CONTRIBUTING.md) for the full dev setup)

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the contributor workflow. Quick reference:

    npm install
    npm start             # run the app
    npm test               # unit and integration tests
    npm run test:component # renderer tests in headless Chromium
    npm run test:e2e       # Playwright tests against the built renderer (off-screen; APIARY_HEADED=1 to watch)
    npm run test:e2e:smoke # the ~1 minute subset that also runs in CI
    npm run typecheck
    npm run lint            # eslint, stylelint, markdownlint, shellcheck, dependency-cruiser
    npm run screenshot      # regenerate docs/screenshot.png (the README image above)

`npm run screenshot` launches the real app against a representative fixture (three
project folders, a git worktree, a few sessions with human-sounding titles), opens
three of them in a layout (placing one in the large pane through the layout picker) with
a shell running under it, and resumes that one so the
picture shows a live session rather than only transcripts, before overwriting
`docs/screenshot.png` — see `scripts/screenshot/screenshot.spec.ts`. The resumed session runs
`scripts/screenshot/fake-claude.sh`, a stand-in that prints a fixed, believable Claude
Code session: the real CLI needs an API key and a network and would render something
different every run, neither of which belongs in a committed image. It's a Playwright
script, not a test (it asserts nothing, and lives outside `tests/e2e` so
`npm run test:e2e` never runs it); run it by hand whenever a change is significant
enough that the README's picture of the app should catch up.

`postinstall` runs `scripts/fix-node-pty-permissions.mjs` automatically after
`npm install`. node-pty ships a small native helper binary, `spawn-helper`,
that it execs before exec'ing your shell; npm's tarball extraction doesn't
reliably preserve its executable bit, and without it every terminal spawn
fails with `posix_spawnp failed`. The script restores the bit, unconditionally
and harmlessly, every time dependencies are installed.

## Packaging

Building installers for distribution (`npm run dist` and friends) is maintainer-facing detail —
see [docs/packaging.md](docs/packaging.md).

## How it works

Sessions are discovered by scanning the Claude config directory. Metadata is read
with bounded head and tail reads rather than parsing whole files, because session
files reach tens of megabytes. Titles come from the `ai-title` entries Claude Code
writes. Working directories are always read from the `cwd` field inside the JSONL,
never derived from the directory name, which is a lossy encoding of the path.

Nothing appears in the sidebar until you import it through File, then Import Claude
Sessions. Ticking a folder also marks it for auto-import, so sessions you start
later in that folder show up on their own.
