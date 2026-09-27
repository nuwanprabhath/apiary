# ADR-0008: Window layouts are a preset table, not a split tree

- **Status:** Accepted
- **Context:** A window arranges up to four panes. A general split-tree model (like a tiling window
  manager) can represent arbitrary arrangements, but every operation on it — "what does zone three
  mean," "what does closing a pane turn into" — has to be computed from the tree each time.
- **Decision:** `Layout` is one of eight fixed presets, each pane a `Column`. "Which shapes can
  exist," "what zone three is," and "what a pane collapses into when closed" are all table lookups
  against the fixed preset set, not tree operations.
- **Alternatives tried:** Not implemented and measured against — chosen up front because a split
  tree's generality was judged not worth the complexity for a UI that only ever needs at most four
  panes and a small, enumerable set of arrangements.
- **Consequences:** Adding a ninth arrangement means adding a preset (and its zone table), not
  extending a tree algorithm. A design that wants an arbitrary split (not one of the eight shapes)
  does not fit this model without revisiting the decision.

See [`src/renderer/state/CLAUDE.md`](../../src/renderer/state/CLAUDE.md).
