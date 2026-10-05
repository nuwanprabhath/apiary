---
name: blast-radius
description: Find what an Apiary change could break outside its own diff (persisted state, the IPC contract and its fake, other windows, the packaged build, workers, themes, other OSes) and prove the one fact it is safe because of by running real code. Use for "blast radius of X", "what could this break", "is this safe to ship", or before merging a diff you don't fully trust.
---

# Blast radius

Find what a change breaks somewhere else, before it ships. Listing callers is not the job: grep
does that in a second. The job is the breakage grep does not show.

## Don't trust your own writeup

A writeup that sounds right reads the same whether or not it is true. Find the one or two facts
the change's safety depends on and push each as far down this list as is cheap, then say where it
stopped:

1. You said so. Worth nothing alone.
2. You pointed at the line: a real `file:line` here, or in the library's source in `node_modules`.
3. You walked the failure step by step and showed it cannot reach.
4. You ran it: a unit test or a short script that calls the real code and fails loud if you are
   wrong.
5. You reproduced it in the running app (the `verify-apiary` skill).

## Steps

1. **Read the change.** The diff, every symbol it adds, changes or removes, and what now behaves
   differently that the diff does not spell out. `git log -p` on the touched files shows why they
   were shaped that way; nested `CLAUDE.md` files and `docs/adr/` often name the bug a line exists
   to prevent.
2. **Find the one fact it is safe because of.** Most risky-looking changes are safe because of a
   single fact ("`migrateSettings` fills the new field before anything reads it"). If it holds,
   most of the maybes clear at once. Spend the time here.
3. **Look where grep stops.** In this repo, check each of these that the change touches:
   - **Persisted state.** `settings.json` (a default change needs `SETTINGS_VERSION` and
     `migrateSettings`; a missing field over IPC means unchanged), `pets.json`, `themes.json`,
     `session-layout.json`, `apiary.db` and `search.db` schemas, the pet render cache in IndexedDB
     (`RENDER_VERSION`). What does a profile written by the previous release look like after this
     change, and after a downgrade? Table of files: `docs/environment.md`.
   - **The IPC contract.** A changed argument guard or result type in
     `src/shared/ipc/contract.ts` must be mirrored in `tests/component/fakeApiary.ts`, including
     events main emits after the call, or component tests pass against behaviour the app lacks.
   - **More than one window.** Detached tabs and extra windows each run their own renderer; a pty
     belongs to main and outlives any one view (`docs/architecture/windows-and-tabs.md`).
   - **The packaged build.** Every `APIARY_*` hook is ignored when packaged, so a test that only
     passes through one proves nothing about a real install. Native modules, asar paths, Electron
     fuses, `latest-*.yml` and the macOS zip target (`src/main/update/CLAUDE.md`,
     `docs/packaging.md`).
   - **Bundling.** Main is ESM; a named import from a CommonJS package typechecks and then throws
     at load (`tests/e2e/appBoots.spec.ts` exists for this). Worker chunks (the pet brain and 3D
     renderer) are separate bundles.
   - **Timing.** React effects and cleanup order, worker message ordering, chokidar debounce, the
     pty's first write arriving before its program exists (`docs/debugging.md`).
   - **Look.** Every theme, not only the one on screen: Liquid Glass and original, light and dark
     tokens, no literal colours in CSS, `--z-*` stacking.
   - **Other OSes.** The custom title bar on Windows and Linux (`APIARY_WINDOW_CHROME=custom`),
     shell differences in `src/main/pty/`.
   - **Data from outside.** Claude JSONL shapes, `claude -p` output, git porcelain, `glab` JSON.
     A field that is sometimes missing in a real transcript is the classic miss; fixtures are
     recordings, not inventions.
4. **Be honest about each risk.** Give it a likelihood and a cost. Keep confirmed risks; list the
   ones you checked and cleared separately. Cite a real `file:line`. A search that finds nothing is
   still an answer. Never invent a caller or an API.
5. **Prove the one fact.** Write the test or script, run it, paste what happened. A test that
   proves it permanently belongs in `tests/`; a throwaway goes in the scratchpad.

## What to hand back

- **What it does**, including the part that is not obvious from the diff.
- **The one fact it is safe because of**, the level from the list above you reached, and the
  proof. If you could not prove it, write "unproven".
- **Risks**: how each breaks, `file:line`, likelihood and cost, how to check.
- **Cleared**: what you checked and why it is fine.
- **Before you merge**: the cheapest test or repro that would catch the real bug.
