# ADR-0018: Pet renders are cached in IndexedDB, a second renderer persistence

- **Status:** Accepted
- **Context:** A pet is rendered in 3D once, in a worker, into image layers; on a real GPU three pets
  take about 2 seconds, and software WebGL is much slower. Rendering at every launch would leave the
  pets hidden for that long each time. The layers are images, each under a megabyte.
- **Decision:** `src/renderer/features/pets/render3d/usePetImages.ts` keeps the renders in IndexedDB
  (database `apiary-pets`, store `renders`), keyed by the pet's look and `RENDER_VERSION`, at most 24
  entries with the oldest dropped first. Every access is allowed to fail (a private profile, cleared
  storage): the pet is then rendered again. Everything else the renderer persists goes through
  `state/uiState.ts`.
- **Alternatives tried:** Render at every launch (measured as above). Putting the renders through
  `uiState.ts` (small keyed UI values in `localStorage`) was not tried: its values are small, these
  are images.
- **Consequences:** The cache is derived data and safe to lose. Bump `RENDER_VERSION` whenever the
  rendered output changes, or old renders are shown. The file is the only allowed raw storage besides
  `uiState.ts`, and its silent catches carry a reason.
- **Enforced by:** the ESLint rule `no-raw-storage`, whose `allow` names exactly `state/uiState.ts` and
  this file; `tests/unit/architecture/sanctionedRules.test.ts` proves the rule fires elsewhere;
  `tests/component/petRender3d.test.tsx`.

See [`src/renderer/features/pets/CLAUDE.md`](../../src/renderer/features/pets/CLAUDE.md).
