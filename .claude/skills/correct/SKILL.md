---
name: correct
description: Turn a mistake agents keep repeating in Apiary into one the repo makes impossible, choosing architecture first, then types, then a lint or hook whose error names the fix, then a test, and writing a docs rule only when nothing else can check it. Use for /correct, or when the maintainer corrects the same thing a second time.
---

# Correct

The maintainer keeps correcting agents for the same mistakes. Change the repo so the next agent
cannot make them. Assume every contributor sees only the files it opened, copies the nearest
example, and takes the shortest path that compiles.

## Find the mistake classes

Read recent commits and reverts (`git log`, `git log --diff-filter=D`), fix-up commits, the
maintainer's corrections in the conversation, and the auto-memory notes for this project. Group
the mistakes into classes. A class counts once it has happened twice.

## Fix each class at the highest level that works

1. **Architecture.** One owner per piece of state, one supported way per task. This repo's
   examples: `contract.ts` is the single source for IPC (preload and types derive from it),
   `validatePet`/`validateTheme` are the only way data gets in, `tidyLayout` is the only way a
   layout changes.
2. **Types.** Make the bad state unwritable: `Record<Kind, …>` so a missing entry is a compile
   error (`EFFECT_NOTES`), `fakeApiary.ts` typed as `ApiaryApi`, `switch-exhaustiveness-check`.
3. **A check whose error names the fix.** In order of preference:
   - an `apiary/*` rule: one entry in `eslint/sanctioned.js` (an import, syntax or global
     restriction, with an allowlist of its sanctioned homes and a message naming the replacement),
     plus a case in `tests/unit/architecture/sanctionedRules.test.ts`;
   - a dependency-cruiser layer rule (`.dependency-cruiser.cjs`);
   - an architecture test in `tests/unit/architecture/`, with a shrink-only allowlist;
   - stylelint (`.stylelintrc.json`), `scripts/check-doc-refs.mjs`, or the knip ratchet;
   - the git hooks (`.husky/`) or the agent hooks (`.claude/hooks/`), and commitlint.

   If the pattern is already common, fail only on new occurrences. Baseline today's sites with
   `npx eslint . --suppress-rule apiary/<name>` (stylelint: `--suppress`; dependency-cruiser:
   `npm run lint:arch:baseline`). Every baseline may only shrink.
4. **A test of the behaviour.** In the cheapest layer that proves it (`tests/CLAUDE.md`). Fix or
   delete any test that would still pass if the code under it returned nothing.
5. **A rule in `CLAUDE.md`**, last, only for judgment calls. Nothing fails when an agent skips it.

## Fix and prove

Fix the most frequent class first, one commit each, following the repo's commit and version rules
(root `CLAUDE.md`). Prove each new check fails on a real past mistake: check out or recreate the
bad change and show the error. A check that never failed has not been shown to work. Run it the
same way locally and in CI (`.github/workflows/ci.yml`). An exception goes on the offending line
with a reason, the way disable comments already do here (`-- <reason>`).

## Keep the rule table

Keep the pairing of each rule with what enforces it in root `CLAUDE.md` ("Never", "Hard rules").
When a rule is already written down and was broken anyway, nothing enforces it: move it up a level
in the same change. Drop a rule once its mistake can no longer happen.

**Reply:** each class with its evidence (commits, corrections), the level you picked, why a higher
level did not work, and the proof that the check fails on the real mistake.
