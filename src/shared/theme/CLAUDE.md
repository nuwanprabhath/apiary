# Themes

Read with root CLAUDE.md; this covers the theme data model, validation and the generator. See also
[`src/renderer/CLAUDE.md`](../../renderer/CLAUDE.md) for the renderer-only conventions (radius
tokens, no `backdrop-filter`, floating chrome) and root CLAUDE.md's hard rule: "a theme is data;
`validateTheme` is the only way in."

A theme is **data, never code** (this folder). `validateTheme` is the only way anything becomes a
`ThemeSpec` and is the feature's security boundary: it reads only allowlisted names as own
properties, accepts only numeric colour syntaxes and re-serialises them as `#rrggbbaa`, clamps
numbers, drops unknown fonts and effects, and then fixes readability (`ensureReadable`) and opacity
(`limitAlpha`: the transcript, terminal and their backgrounds stay solid). Everything that reads a
theme validates again: `ThemeStore` on load, the store on save, the generator on every reply. Keep
it that way.

- **Nothing a theme contains is parsed as CSS.** `applyTheme` (renderer) sets allowlisted custom
  properties (`themeToCssVars`) and two font attributes whose stacks live in `styles.css`. No
  injected stylesheet, no HTML, no URL, no remote font. A new themable thing is a new token plus an
  allowlist entry in `spec.ts`.
- **Effects are Apiary's own draw functions** (`effects/`): pure functions of time, with an opacity
  cap each, tested in Node against a recording context. `ThemeEffects.tsx` (renderer) only decides
  *when* to draw (30 fps cap, pause when hidden or backgrounded, a still frame under reduced motion
  or with Animated effects off).
- **Glass (`material: glass`)** lets `bg`, `bg-panel`, `bg-terminal` and controls go see-through
  (floors in `MIN_ALPHA.glass`). `ensureReadable` checks text against every colour that can show
  through (`backdrops`: the window, plus each background effect's colours — saturated as drawn —
  at its opacity cap): borderline colours are fitted first, then panes thickened (a surface only
  if its own colour contrasts with the text, otherwise the panel/page under it).
- **Theme performance is measured, not guessed**: `tests/e2e/bench/themePerf.spec.ts`
  (`APIARY_BENCH=1`, add `APIARY_BENCH_GPU=off` for software compositing) compares every built-in
  theme with the original look on hover, scroll, fold, divider drag and terminal typing — input to
  presented frame (Event Timing) and long frames, median of 3 runs. Run it after touching effects,
  glass or anything painted over the whole window. Without GPU compositing
  (`themeGpuCompositing()`, logged once as `theme gpu`) effects draw at 15 fps and 1×; during a
  divider drag they hold their frame. Moving effects to a worker was tried and measured slower in
  software compositing — the cost is compositing, not drawing.
- **Liquid Glass is the first-run default** (`DEFAULT_THEME_ID`, only when `themes.json` does not
  exist). The E2E harness starts on the original look (`APIARY_DEFAULT_THEME=original` in
  `launchEnv`); `realDefaultTheme: true` gets the real default.
- **The generator** (`main/theme/themeGenerator.ts`) runs the user's `claude` as
  `-p --output-format json --tools "" --safe-mode --strict-mcp-config --no-session-persistence
  --json-schema …` in an empty temp dir, through the login shell with every argument as its own
  positional parameter (`exec "$0" "$@"`) — nothing typed is ever parsed by a shell.
  `--no-session-persistence` matters: without it every generation would appear in the sidebar.
  The schema is built from the spec allowlists (`prompt.ts`), so the two cannot drift; the reply
  still goes through `validateTheme` in main before the renderer sees it. Real generations take
  45–55 s on Sonnet; `tests/e2e/live/themeGenerator.spec.ts` checks a real reply has nothing the
  validator must drop. Adding a new effect needs `spec.ts`'s `EFFECT_KINDS`, `effects/index.ts`'s
  `EFFECTS`, and `prompt.ts`'s `EFFECT_NOTES` — see root CLAUDE.md's "How to add… a theme effect".
- **A preview belongs to one window and one screen**: the Themes section applies it locally and
  puts back the active theme when it unmounts. The effects layer follows what is *applied*
  (`useAppliedTheme`, fed by `applyTheme`'s event), not the saved choice, so previews show effects.
- **Ways back:** View → Reset Theme (native menu, Cmd/Ctrl+Alt+Shift+T), `--safe-theme` /
  `APIARY_SAFE_THEME=1`. Holding Shift at launch was specced and dropped: Electron's main process
  cannot see a modifier held before the first key event.
