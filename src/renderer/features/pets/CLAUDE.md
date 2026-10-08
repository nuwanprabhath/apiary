# src/renderer/features/pets: drawing and moving the pets

Read with root CLAUDE.md and [`src/shared/pets/CLAUDE.md`](../../../shared/pets/CLAUDE.md), which
covers what a pet is, the brain, the 3D render and the performance rules. This is how the renderer
side is organised.

## What lives here

- `PetLayer.tsx`: mounts everything while pets are on and one is out; nothing mounts otherwise.
  Owns dragging, the pet menu, errands and the brain's event feed.
- `PetSprite.tsx`: one pet as stacked image layers; chooses the front or profile view.
- `PetChat.tsx`: the small chat popover. `SceneryLayer.tsx`: scenery and the ball behind the pets.
- `parts.tsx`: the flat SVG version, used where WebGL is unavailable.
- `brainClient.ts` and `petBrain.worker.ts`: the behaviour brain in a Web Worker.
- `useHabitat.ts`: measures where pets may stand (the rail and the free stretch of the status bar).
- `render3d/`: the three.js renderer (`petRender.worker.ts`, `plush.ts`, `sdf.ts`, `props.ts`,
  `frames.ts`) and `usePetImages.ts`, which asks the worker and keeps renders in IndexedDB.

## The sanctioned way

- **Read pets with `usePets()`** and act with the commands in `src/renderer/state/petsStore.ts`
  (`rememberPetPlace`, `resizePet`, `putPetAway`, `petRemark`, `askPetVoice`). Never call
  `window.apiary.pet*` here (`bridge-via-state`). Each command already has its error policy: a drop is
  logged (the pet already stands there), a resize or put-away is shown, a remark is best effort.
- **A new part, prop or scene** is a closed-set entry in `src/shared/pets/` plus its drawing in
  `render3d/parts3d.ts` or `render3d/props.ts` and in `parts.tsx`. Bump `RENDER_VERSION` in
  `usePetImages.ts` whenever the rendered output changes, or old saved renders are shown.
- **Persistence**: the render cache in IndexedDB is allowlisted in `no-raw-storage`
  ([ADR-0018](../../../../docs/adr/0018-pets-render-cache-in-indexeddb.md)). Nothing else here stores
  anything; the pets themselves live in main.
- **Icons** here are the one place raw `<svg>` is allowed (`icons-from-ui` allows `features/pets/`).
- **Moving a pet** is a `transform` transition lasting distance over speed. A drag writes the
  transform straight onto the element, with no React render per pointer move.

## Tests

- `tests/component/petLayer.test.tsx` (including the DOM-write budget), `petSprite.test.tsx`,
  `petRender3d.test.tsx`, `tests/component/petsSettings.test.tsx`.
- `tests/unit/petBrain.test.ts`, `tests/unit/petHabitat.test.ts`, `petParts3d.test.ts` for the pure parts.
- `tests/e2e/pets.spec.ts` for the real app. Component tests draw flat and can speed the brain
  up through `setTestSeams` in `src/renderer/state/testSeams.ts`, the one test seam the renderer has
  ([`src/shared/pets/CLAUDE.md`](../../../shared/pets/CLAUDE.md)).

## Pitfalls

- **Only HTML layers animate.** A transform animation on an element inside an SVG repaints the whole
  SVG every frame. Keep breathing, blinking and walking on HTML layers.
- **Hide a pet until its render is ready**, so it never flips from flat to 3D in front of the user.
- **Saved renders may be absent.** Every IndexedDB access is allowed to fail (private profile,
  cleared storage); the pet is then rendered again. Each silent catch there carries a reason.
- **The drag in `PetLayer.tsx` is a deliberate exception** to `drag-via-use-resize-drag`: it moves a
  pet in two dimensions and tells a click from a drag, which `useResizeDrag` does not do.
- **Props are rendered for one view.** A side-on laptop beside a pet facing the window would float,
  so a prop shows only in its own view (`PROP_VIEW`).
- **The page never trusts a pet.** Anything drawn came through `validatePet` in main; text is drawn as
  text only.
