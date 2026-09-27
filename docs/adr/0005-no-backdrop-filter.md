# ADR-0005: No `backdrop-filter`, anywhere, in glass themes

- **Status:** Accepted
- **Context:** The glass theme material needs panes that look like they're seeing through to the
  content and effects behind them.
- **Decision:** Nothing uses CSS `backdrop-filter`. A pane's translucency comes from the theme's own
  alpha values, and what shows through it is only the window colour plus a background effects
  canvas that `ThemeEffects` itself draws already blurred and saturated.
- **Alternatives tried:** The first version used a live `backdrop-filter` per pane, with an SVG lens
  for the refraction look. Measured cost: it re-ran on every frame and every hover, adding ~800ms of
  lag without GPU compositing. It was replaced with the current approach — "refraction" reduced to a
  static lens-edge glow (`--glass-rim`) — and the blur moved to a single canvas drawn once per frame
  rather than once per pane per frame.
- **Consequences:** A future "make glass look more real" request should not reach for
  `backdrop-filter` again without re-measuring under software compositing; the cost was compositing,
  not the filter's visual quality.

See [`src/shared/theme/CLAUDE.md`](../../src/shared/theme/CLAUDE.md).
