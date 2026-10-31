# Apiary

One desktop app for every Claude Code session on your machine: find any conversation in seconds,
pick it up where it left off, and work on several side by side, even on another computer.

![Apiary in its default Liquid Glass theme: a searchable sidebar with an Active section listing open sessions, Pinned and grouped sessions below it, and three sessions arranged in a layout — a chat in the large pane in the middle of a long run, with finished and pending tool calls, a thinking row, code and the working timer counting up above its message box; Claude Code's own terminal on the top right; and a chat on the bottom right where Claude asks a single multiple-choice question and the message box is folded away — with three fuzzy pets and the Claude plan-usage meter on the status bar along the bottom](docs/screenshot.png)

![Regent, Apiary's chief of staff, in a floating chat panel over a session pane: the earlier request "Open the session for !1175" with a possible-match card and a chip for the session it opened, which is open behind the panel, and the question "What auth did we design between core and wildobs?" answered in a short paragraph with two clickable session chips and a three-item bullet list; on the status bar below, the gold Regent bee and the MR desk's honey pot with a count badge and the text "2 MRs ready to approve"](docs/screenshot-regent.png)

*Regent, a chief of staff over all your sessions: ask it to find, open or answer from any of them. Beside it, the MR desk's honey pot says two merge requests wait for you.*

![Remote access: a window titled with the work machine's name and a remote badge in the title bar, its sidebar listing that machine's sessions grouped by project folder, and a chat session in the main pane with finished tool calls and a thinking row, the message box showing the slash-command menu (/clear, /compact, /context, /review, /security-review, /init) above the model pill, context meter and Stop button](docs/screenshot-remote.png)

*Remote access: run Apiary on your work machine and use it from home over SSH or Tailscale. This window is the work machine's sessions, chats and slash commands, live.*

## Why Apiary

- **Every session in one place.** Apiary reads the session files Claude Code already writes, groups
  them by the folder they started in and nests git worktrees under their repository. There is
  nothing to set up and nothing copied.
- **Ask, don't search.** Regent knows every session: the merge requests and tickets they mention,
  and digests of the topics inside long ones. Ask it to open the right one, or to answer from them.
- **Find it again.** Fuzzy search over titles and your own notes, plus Pinned, Active and Recent
  lists, so last month's session is a few keystrokes away.
- **Pick up where you left off.** Resume any session in its own working directory, in a terminal or
  as a chat. Both drive the same `claude --resume`, so the transcript stays the one record.
- **Several at once.** Tabs, layouts of up to four panes, windows of their own, and a shell beside
  every session.
- **Your work machine, from home.** Open the Apiary on another computer over SSH or Tailscale, the
  way VS Code Remote-SSH works: its sessions, terminals and chats in a window here, arranged in
  the same groups and pins. Nothing listens on the network.
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
- **Residents** (optional, in Settings → Residents): always-on Claude agents with a badge on the
  status bar, their own hours, and a chat panel. Right-click a badge for its quick actions, such
  as turning it off, its settings, or the kind's own.
  - **Regent** answers from all your sessions. Click the bee or press ⌘⇧Space, or press ⌘↵ in the
    sidebar search. It opens a session or answers with chips that open the ones it used, and keeps
    its history across restarts. It has Claude's full tools, asking permission in the chat as chat
    mode does. During its hours, a cheap model writes topic digests of your sessions, looking back
    as far as you choose and pausing when your 5-hour usage passes a level you set.
  - **The MR desk** watches the GitLab merge requests you review through `glab`: it reviews new
    ones, checks threads and tells you which are ready to approve. Its honey pot shows a count and
    a line when something needs you. Right-click it for Show the desk and Stats.
  - **Links find their session:** paste a merge request, issue or Jira link, or a ticket key, in the
    sidebar search to find the session that mentioned it.
- **Remote access** over SSH: hosts from `~/.ssh/config`, recent connections and Tailscale;
  reconnects on its own; starts Apiary on the work machine if it is not running; optional pairing
  code.
- **Open in VS Code**, locally or over Remote-SSH from a remote window.
- **Themes**, including Liquid Glass, or describe one and Claude designs it.
- **Pets** (optional): small 3D characters on the status bar that react to what Claude is doing.
- **Several Claude accounts:** new sessions start in the default account from Settings, and any
  session can move to another one from its `/` menu or tab, without signing out anywhere else.
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
    npm run screenshot         # regenerate docs/screenshot.png (the first README image)
    npm run screenshot:regent  # regenerate docs/screenshot-regent.png (Regent and the MR desk, with stand-in claude and glab)
    npm run screenshot:remote  # regenerate docs/screenshot-remote.png (needs Docker)

`npm run screenshot` launches the real app against a representative fixture (project
folders, a git worktree, sessions with human-sounding titles), opens three sessions in a
layout, and overwrites `docs/screenshot.png` — see `scripts/screenshot/screenshot.spec.ts`.
The two chat panes open on conversations written by `scripts/screenshot/stories.ts` and
continue them with `scripts/screenshot/fake-claude-chat.mjs` (one turn that never finishes,
one that ends in a question); the terminal pane runs `scripts/screenshot/fake-claude.sh`,
which prints a fixed Claude Code screen. The usage meter shows numbers fed through
`APIARY_FAKE_USAGE`, so nothing reads a real token. The real CLI needs an API key and a
network and would render something different every run, neither of which belongs in a
committed image. The script waits about a minute so the chat's timer reads over a minute.
`npm run screenshot:remote` makes the second picture for real: it builds and starts the
Docker test bed of `npm run test:remote` (an Ubuntu container running the built app as the
work machine), connects this machine's app to it over SSH, sends one message in a chat and
opens the `/` menu, then photographs only the remote window. The first run builds the image
(minutes, several GB; keep disk free). See `scripts/screenshot/remote.shot.ts`. The container's
`claude` is the same stand-in. It's a Playwright
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
