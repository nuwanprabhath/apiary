# ADR-0009: Shorten the bash prompt with `PROMPT_DIRTRIM`, never by writing `PS1`

- **Status:** Accepted
- **Context:** A deep worktree path can eat the whole first line of a shell prompt. Shortening it
  needs to change how `\w` renders.
- **Decision:** Spawn the shell with `PROMPT_DIRTRIM` set (bash's own directory-trimming variable)
  rather than overwriting `PS1`.
- **Alternatives tried:** Writing a replacement `PS1` was considered and rejected before
  implementation — reasoned through, not measured: overwriting a prompt someone configured
  themselves, from a checkbox in Settings, is not a trade anyone asking for a shorter path actually
  wants. zsh has no `PROMPT_DIRTRIM` equivalent and is deliberately left untrimmed by this feature —
  the separate, opt-in Minimal Prompt setting handles zsh differently (a `ZDOTDIR` shim), and is a
  different, more invasive feature the user turns on explicitly.
- **Consequences:** A future "shorten the prompt further" request for bash should extend
  `PROMPT_DIRTRIM` usage, not add a second mechanism; zsh path-trimming (as opposed to full minimal
  prompt) stays a known gap, not a bug.

See [`src/main/pty/CLAUDE.md`](../../src/main/pty/CLAUDE.md).
