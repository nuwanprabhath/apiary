---
name: maintain-verify-apiary
description: Audit and repair the verify-apiary skill and its feature map so they still match the app — read every feature from source, drive every feature live in the real app, and ship at most one commit of proven corrections. Use before a release, after a change that renames test ids or moves a feature, or when asked to "audit the verify skill" or "check the feature map".
---

# Maintain verify-apiary

`.claude/skills/verify-apiary/` is how an agent proves behaviour in the real app: `verify.sh`
(doctor, run, cleanup), drives under `drives/`, and a feature map under `features/`. The map is
only useful while it is true, and every release moves something. This pass keeps it true. The unit
of care is the feature: every feature file is read against the source and every feature is driven
live once. You do not need to re-prove each sentence.

Adapted from Cursor's `maintain-verification-skill` (cursor/plugins, pstack). Its generating
counterpart, `create-verification-skill`, is not needed here: `verify-apiary` already has the
launch, doctor, drive, evidence and feature-map shape it produces.

## The outcome is one of three

Say which one at the end:

- **clean**: every feature was read from source and driven live, and nothing needed changing. No
  commit.
- **changed**: one commit of corrections, each one proven by a live drive. Use `docs(verify):` or
  `test(verify):` (no version bump; it changes no shipped code).
- **blocked**: coverage could not finish, or a correction could not be proven. Say exactly what
  stopped it (a feature that needs the real `claude`, Docker, a second machine).

## Edit only the skill

During the pass, change only `.claude/skills/verify-apiary/` (its `SKILL.md`, `features/`,
`drives/`, `lib.ts`, `verify.sh`). Never change product code here:

- the map describes something the app does not do any more: if the change was intended, the map
  has drifted (fix the map); if not, it is a regression (report it to the maintainer, and do not
  edit the map to match the bug);
- the app works but no drive can reach it: that is a harness gap (fix the drive or `lib.ts`);
- the app is broken: that is a product bug (report it, keep it out of this commit).

## The pass

1. **Index.** Compare `features/README.md` with the files beside it. Fix missing, extra,
   duplicated or dead rows. Then list what users can reach that has no file: look at the
   changelog sections since the last audit (`git log -- .claude/skills/verify-apiary`) and at
   `src/renderer/features/`. Name a concrete source path before calling a feature missing, and add
   a file for it in the existing shape: `## Sub-features`, `## How to get to it (user POV)`,
   `## Driving it with launchApiary`, `## Gotchas`.
2. **Read the source, in parallel.** For each feature file, start one read-only agent (the
   `Explore` type) with the file's text. It answers:
   - how the feature works, from source;
   - its entry points (`file:line`);
   - each claim in the file that the source contradicts, with a citation;
   - one recipe for driving it live (test ids, clicks, the end state to measure).

   It does not drive the app or edit files. Run at most six at once: more than that exhausted this
   Mac's memory twice.
3. **Reconcile.** Every feature file has an answer. Spot-check each cited contradiction yourself.
   Do not re-prove claims nobody disputed. Merge the recipes so as few app launches as possible
   cover all features.
4. **Drive everything live, yourself.** This is required even when the source looked clean. One
   drive at a time, through `verify.sh` (write throwaway drives in `drives/local/`). Keep three
   rules for the whole pass:
   - never drive an instance you have not checked since it last surprised you: run `verify.sh
     doctor` before the first drive and again after any failed drive;
   - evidence survives: check that `.verify/evidence/` still has each run's screenshots and notes
     after cleanup;
   - nothing you started outlives its use: `verify.sh cleanup --kill` after a failed drive and
     at the end.

   A feature you cannot reach is "unreachable" only with the concrete prerequisite (the real
   `claude`, Docker, a remote machine) and the route you tried. If the map does not mention that
   prerequisite, the map has drifted. A doctor failure caused by the skill's own drift is drift:
   fix it and retry once, then call the pass blocked.
5. **Sort and fix.** Wrong or missing description: fix the map. Harness gap: fix the drive and
   drive it again live before keeping the fix. Product bug: write it down for the maintainer.
   Promote a drive from `drives/local/` to `drives/` when it covers a mapped feature and is worth
   rerunning; list it in the README's "Shipped drive" column.
6. **Ship or stop.** For "changed", re-read every file you changed, then make one commit. For
   "clean" or "blocked", commit nothing and report the outcome with the coverage: features read,
   features driven, features unreachable and why.

Keep run notes (coverage, prerequisites, drift found) in the scratchpad, not in the repo.
