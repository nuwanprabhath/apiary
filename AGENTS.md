# Agents

Read [`CLAUDE.md`](CLAUDE.md): the map, the rules, the commands and the definition of done. They
apply to every coding agent, not only Claude. The nested `CLAUDE.md` files next to the code you
touch hold the reasons behind each subsystem's rules.

The rules are enforced, not only written down. When a check fails, its message says what to use
instead:

- `npm run lint` runs everything below.
- `eslint/sanctioned.js` defines the `apiary/*` rules: one sanctioned way to do each thing.
- `.dependency-cruiser.cjs` enforces layer direction (`npm run lint:arch`).
- `scripts/knip-ratchet.mjs` blocks new dead code (`npm run lint:dead`).
- `tests/unit/architecture/` holds the architecture tests.
- `scripts/check-doc-refs.mjs` fails when a doc names a path, symbol or link that no longer exists.

Each baseline (`eslint-suppressions.json`, `stylelint-suppressions.json`,
`.dependency-cruiser-known-violations.json`, `.knip-baseline.json` and the architecture tests'
allowlists) may only shrink. Fix the code; do not grow a baseline.

If you are coordinating other agents (headless Haiku or Sonnet sessions in worktrees), read
`.claude/skills/agent-orchestration/SKILL.md` first: it records how such runs failed and how to set
them up so they do not.

If your change is something a person sees, read `.claude/skills/ui-review/SKILL.md`: put each state
in a UI scenario under `tests/component/ui/`, pass the UI audit, and look at your screenshots
(`npm run ui:review`). The Stop hook refuses a renderer change without one.
