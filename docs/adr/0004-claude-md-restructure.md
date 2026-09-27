# ADR-0004: Split CLAUDE.md into a short root plus co-located docs

- **Status:** Accepted
- **Context:** Root `CLAUDE.md` reached 627 lines (about 11k tokens), loaded into every agent
  session regardless of what was being worked on. It was organised as a sequence of war stories, one
  subsystem sometimes split across non-adjacent sections, with no command reference, no "how to add
  X" recipes and no definition of done.
- **Decision:** Move each subsystem's prose, verbatim, to a `CLAUDE.md` next to the code it
  describes (loads automatically when an agent reads a file in that directory) or to
  `docs/architecture/*.md` for topics spanning main and renderer. Root keeps only what applies
  everywhere: the architecture map, commands, hard rules (one line each, linking to the full story),
  "how to add X" recipes, and the versioning/DoD rules.
- **Alternatives tried:** `@path` imports (which Claude Code expands eagerly, so they cost the same
  tokens as leaving everything in one file) were considered and rejected before implementation —
  they solve organisation, not the size problem.
- **Consequences:** New "why" prose for a subsystem goes in that subsystem's nested `CLAUDE.md`, not
  back into root. A hard rule that would silently break something if skipped still needs its one-line
  summary in root, even though the full story lives elsewhere.

See root [`CLAUDE.md`](../../CLAUDE.md) and [`docs/architecture/README.md`](../architecture/README.md).
