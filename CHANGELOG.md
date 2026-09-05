# Changelog

All notable changes to Apiary are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-05

Initial release.

### Added

- Sidebar listing every Claude Code session, grouped by the folder it started
  in, with git worktrees nested under their parent repository; fuzzy search
  narrows both sessions and folders as you type.
- File > Import Claude Sessions dialog — nothing appears until it's
  explicitly imported; ticking a folder also marks it for auto-import so
  later sessions there show up on their own.
- Transcript view rendering the full conversation as markdown, with tool
  calls/results collapsed into expandable blocks and subagent (sidechain)
  messages hidden by default.
- Resume any session in an embedded terminal running `claude --resume` in
  its recorded working directory, with conflict detection and an option to
  fork instead of a session that's already running elsewhere.
- Start a brand-new `claude` session directly from the sidebar via a "+" on
  any folder.
- Open a plain interactive shell alongside any session, in its own
  independent, resizable pane.
- Rename a session — including one just started but not yet resolved into a
  real session — with the custom title persisted and never overwritten by
  Claude's own later title generation.
- Remove a session from view without touching its transcript file on disk;
  it stays importable again at any time.
- Window bounds, sidebar width, collapsed folders, the selected session, and
  the shell pane's height all persist across restarts.
- App icon, and packaging for macOS (`.dmg`, arm64 and x64) and Linux
  (`.AppImage`, `.deb`).
