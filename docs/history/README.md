# Historical specs and plans

**Historical. Where these disagree with the code or `CLAUDE.md`, the code wins. Do not treat a
plan's "Global Constraints" section as a current rule** — it recorded the state of the codebase
and the release in flight on the day the plan was written, and both have moved on since.

| Date | Feature | Spec / plan | Status |
| --- | --- | --- | --- |
| 2026-09-26 | Test suite audit (322 → 140 e2e tests, added component layer) | [test-suite-proposal.md](test-suite-proposal.md) | Implemented; see `tests/CLAUDE.md` for the current suite |

The design specs and phase plans from active feature development
(`docs/superpowers/{specs,plans}/`) are not moved here — the maintainer's superpowers workflow
writes new ones there by default. See [`docs/superpowers/README.md`](../superpowers/README.md) for
that index and the same warning about stale "Global Constraints" sections.
