# Superpowers plans and specs

**Historical working notes. Where these disagree with the code or `CLAUDE.md`, the code wins. Do
not treat a plan's "Global Constraints" section as a current rule** — each one recorded the state
of the codebase and the release in flight on the day it was written, and both have moved on since
(a "known pre-existing flake" a plan names may be long fixed; a "release version for this feature"
a plan states may no longer match `package.json`).

This folder is where the maintainer's `superpowers` skills write new plans and specs by default —
kept here (rather than moved to `docs/history/`) for that reason. New plans go here; once the
feature they describe has shipped, add a row below.

| Date | Feature | Spec | Plan |
| --- | --- | --- | --- |
| 2026-09-03 | Apiary (initial build) | [specs/2026-09-03-apiary-design.md](specs/2026-09-03-apiary-design.md) | [plans/2026-09-03-apiary.md](plans/2026-09-03-apiary.md) |
| 2026-09-05 | Git toolbar | [specs/2026-09-05-toolbar-git-terminals-design.md](specs/2026-09-05-toolbar-git-terminals-design.md) | [plans/2026-09-05-git-toolbar.md](plans/2026-09-05-git-toolbar.md) |
| 2026-09-05 | Multi-terminal panel | same spec as above | [plans/2026-09-05-multi-terminal-panel.md](plans/2026-09-05-multi-terminal-panel.md) |
| 2026-09-09 | Error reporting, pinned sessions, README split | — | [plans/2026-09-09-error-handling-pinning-and-readme.md](plans/2026-09-09-error-handling-pinning-and-readme.md) |
| 2026-09-09 | Bottom-pane overflow, terminal management, screenshot | — | [plans/2026-09-09-layout-overflow-terminal-mgmt-screenshot.md](plans/2026-09-09-layout-overflow-terminal-mgmt-screenshot.md) |
| 2026-09-09 | UI changes and bug fixes (12-item batch) | — | [plans/2026-09-09-ui-changes-and-bug-fixes.md](plans/2026-09-09-ui-changes-and-bug-fixes.md) |
| 2026-09-10 | Git menu, column resizing, terminal-cutoff fix — 1.5.0 | — | [plans/2026-09-10-git-menu-column-resize-terminal-fit.md](plans/2026-09-10-git-menu-column-resize-terminal-fit.md) |
| 2026-09-10 | Settings page, import dialog, modal stacking — 1.6.0 | — | [plans/2026-09-10-settings-page-import-dialog-stacking.md](plans/2026-09-10-settings-page-import-dialog-stacking.md) |
| 2026-09-10 | Transcript composer, images, headless tests — 1.7.0 | — | [plans/2026-09-10-transcript-composer-and-headless-tests.md](plans/2026-09-10-transcript-composer-and-headless-tests.md) |
| 2026-09-17 | Pane layouts | [specs/2026-09-17-pane-layouts-design.md](specs/2026-09-17-pane-layouts-design.md) | [plans/2026-09-17-pane-layouts.md](plans/2026-09-17-pane-layouts.md) |
| 2026-09-18 | Ten features — 1.18.0 | [specs/2026-09-18-ten-features-design.md](specs/2026-09-18-ten-features-design.md) | [plans/2026-09-18-ten-features.md](plans/2026-09-18-ten-features.md) |
| 2026-09-24 | Floating panels + theming engine — 1.21.0 | [specs/2026-09-24-look-and-themes-design.md](specs/2026-09-24-look-and-themes-design.md) | [plans/2026-09-24-look-and-themes-1.21.0.md](plans/2026-09-24-look-and-themes-1.21.0.md) |
| 2026-09-24 | Claude theme generator — 1.22.0 | same spec, Part 3 | [plans/2026-09-24-theme-generator-1.22.0.md](plans/2026-09-24-theme-generator-1.22.0.md) |

See also [`docs/history/`](../history/) for closed-out audits (like the test suite proposal) that
don't belong beside in-flight superpowers plans.
