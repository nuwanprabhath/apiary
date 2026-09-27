# Terminals and PTYs

Read with root CLAUDE.md; this covers pty spawning, prompt delivery and prompt shortening. See also
[docs/architecture/windows-and-tabs.md](../../../docs/architecture/windows-and-tabs.md) for who a
pty belongs to across windows, and
[src/renderer/CLAUDE.md](../../renderer/CLAUDE.md) for xterm's key handling and painting.

- Shells can be spawned with extra environment (`SpawnOptions.env`); `promptPath.ts` uses it to set
  `PROMPT_DIRTRIM`, which is bash's own way to shorten `\w` — chosen over writing a `PS1` because
  overwriting a prompt someone configured themselves, from a checkbox, is not a trade anyone would
  take. zsh has no equivalent for the trim and is deliberately left alone there; the separate
  Minimal Prompt setting below *does* use a shim for zsh.
- Sessions are resumed as `$SHELL -l -c 'exec claude --resume <uuid>'`. The login shell is what puts
  nvm/homebrew installs of `claude` on `PATH` (`resumeCommand.ts`).
- **Writing to a PTY is not the same as a program receiving it.** Until a full-screen program starts
  and puts the tty in raw mode, the line discipline is in canonical mode: it buffers by line and
  translates carriage return to newline. A prompt written into that window arrives mangled — this is
  exactly the bug behind "the message appears in Claude's input box but never sends". `sendPrompt`
  waits for the child to take the screen (`CSI ?1049h`) and for its output to settle before writing.
  If you touch prompt delivery, `tests/integration/appService/composer.test.ts` has a stand-in
  slow-starting TUI that reproduces the failure.
- Multi-line prompts are delivered as a bracketed paste (`ESC[200~ … ESC[201~`), or the first newline
  submits a fragment.

## Minimal prompt

**Minimal prompt** (`terminalMinimalPrompt`, default on) is also in `promptPath.ts`: bash gets
`PROMPT_COMMAND="PS1='\$ '"` (runs after `.bashrc`, works in bash 3.2), zsh gets `ZDOTDIR` = a shim
written at startup (`<userData>/prompt-shim/zsh`) that sources the user's own four files from
`APIARY_USER_ZDOTDIR` and appends a `precmd` hook. Verified with real bash 3.2/5.3/zsh on macOS and
bash 5.2/zsh 5.9 on Ubuntu 24.04 (Docker). It overrides the path trim above.

## Snapshots, not raw replay

A view that attaches late to a running pty (a second window, a tab switched back to) is caught up
from a rendered snapshot, never from a raw byte replay — the byte stream was produced at whatever
widths the session had over its life, and replaying it into a narrower pane scrambles the
conversation. Full story: [docs/architecture/windows-and-tabs.md](../../../docs/architecture/windows-and-tabs.md).

## Adding a setting here

If you change a default for `terminalMinimalPrompt` or add a similar pty-environment setting, see
root CLAUDE.md's "How to add… a setting" recipe — a default change reaches nobody without a
migration (`SETTINGS_VERSION`).
