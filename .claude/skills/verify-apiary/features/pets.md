# Pets

Optional desktop pets that live on the status bar and the collapsed sidebar rail, rendered in 3D
by a worker, driven by a brain worker, and voiced by `claude -p` with Haiku.

## Sub-features

- Enable in Settings → Pets (`setting-pets-enabled`), which hatches the first pet
  (`pet-card`, `pet-card-name`). Describe-and-generate, export (`pet-card-export`), import
  (`pet-import`).
- The pet (`pet`, `data-region` `bar` or `rail`), its 3D layers
  (`.pet-sprite[data-render="3d"] .pet-body img`), the floor (`status-bar-floor`).
- Drag to the rail (`sidebar-hide` first, then drop on `sidebar-rail`).
- Right-click menu sizes (`menuitemcheckbox`: Small 44, Medium 64, Large 92, Extra large 128 px;
  `PET_SIZE_STEPS` in `src/shared/pets/state.ts`).
- Chat on click (`pet-chat-input`, `pet-chat-line`); bubbles; scenes (catch, tennis, picnic,
  fishing, tree, drive, parachute) a few times an hour.

## How to get to it (user POV)

Settings → Pets → turn on. Up to three pets are out at once.

## Driving it with launchApiary

`drives/pets.verify.ts` runs the whole enable → 3D render → chat path with a stand-in `claude`
that answers the design prompt. For a scene on demand, scenes and comments have a test seam:
set `globalThis.__apiaryPetBrainOptions = { sceneEveryMs, commentEveryMs, sceneKinds }` in the
renderer before pets start (see `src/renderer/features/pets/brainClient.ts`). To start with
several pets placed, write `pets.json` into the profile and relaunch, as
`scripts/screenshot/screenshot.spec.ts` does.

Proof: the 3D `img` present, the pet's box sitting on `status-bar-floor`, `data-region`, and
screenshots. For "pets stand apart", compare boxes: no two overlap by more than the personal-space
rule in `src/shared/pets/brain.ts`.

## Gotchas

- A pet always breathes, so Playwright never sees it as stable: click with
  `page.mouse.click` at the centre of its `boundingBox()`, never `locator.click()`.
- The first 3D render takes about a second on a real GPU and longer in software; wait up to 60 s.
- A pending pet is hidden until its render lands, so `pet` can exist with nothing on screen yet.
