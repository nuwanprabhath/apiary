# src/main/pets: the pets in the main process

Read with root CLAUDE.md and [`src/shared/pets/CLAUDE.md`](../../shared/pets/CLAUDE.md), which holds
what a pet is, how it is drawn and what it may know about Claude's work. This covers the two files
here and how they are reached.

## What lives here

- `petStore.ts`: `PetStore`, the owner of `pets.json` (whether pets are on, every pet, where each
  stands). It reads and writes through `JsonStore`; every pet read back goes through `validatePet`,
  and one that cannot be read is dropped while the rest are kept.
- `petService.ts`: `PetService`. The pets' use of `claude`: design a pet, write its lines for the
  hour, chat, remark on Claude's work; and export and import of pet files.
- `petPlacement.ts`: `PetPlacement`, which window each pet is out in (`PetRecord.window`, the
  window's number, so a restart puts it back). At most three are out in the whole app (the store's
  cap); only the owning window draws a pet, so it has one brain and its voice is asked for once.
  - A pet put out, hatched or imported goes to the window that asked (`adopt`, `activated`); a
    remote window never hosts one, so it goes to the most recently focused local window.
  - `start()` runs after the startup restore: a pet whose window did not come back (or a record
    from before 1.41, with no `window`) goes to the most recently focused window.
  - A window closing while the app carries on hands its pets to the most recently focused other
    window (`WindowManager.onWindowClosed`); on quit they keep its number for the restore.
  - `dropOutside` is `petDropOutside`: main reads the cursor itself (`screen`), hit-tests with
    `pickWindowAt` and `TabMover`'s focus order, and moves the pet to another local window with
    the drop point in that window's coordinates (`PetsState.arrival`). Over no window, its own, a
    hidden or a remote one, the pet stays.
- `petWindows.ts`: `petWindowing`, the Electron side of `PetPlacement` (the open windows, their focus order and the cursor).

## The sanctioned way

- **A pet field** changes `PetSpec` and `validatePet` in `src/shared/pets/`, never the store. A pet is
  data; nothing is stored or drawn that did not pass `validatePet`.
- **A new `claude` call** is a new kind of call with its own runner from `makeRunner` (one runner per
  kind, so a chat never waits behind a voice refresh). Its answer passes `validatePet` or the line
  cleaner before it is kept. Never log what a pet or the user said.
- **A new pets IPC call**: `npm run new -- ipc <name>`, then the handler in
  `src/main/ipc/handlers/pets.ts`. A patch or context from the renderer is checked by the guards in
  `src/shared/pets/ipcGuards.ts` in the contract, not in the handler.
- **File export and import** live in `PetService` (`exportToFile`, `importFromFile`), through
  `src/main/fs/textFile.ts`. The handler owns only the dialogs and passes the chosen path on. A path
  never comes from the renderer.
- `PetStore`, `PetService` and their runners are built in `createContainer`.

## Tests

- `tests/unit/petStore.test.ts`, `tests/unit/petPlacement.test.ts` (fake windows), `tests/unit/petValidate.test.ts`, `tests/unit/petPrompt.test.ts`,
  `tests/unit/petActions.test.ts`, `tests/unit/petIpcGuards.test.ts`.
- `tests/integration/petService.test.ts`: the service with a fake runner, export and import.
- `tests/e2e/pets.spec.ts`: the real app. The export and import dialogs are answered by
  `APIARY_PET_EXPORT_PATH` and `APIARY_PET_IMPORT_PATH` ([`docs/environment.md`](../../../docs/environment.md)).

## Pitfalls

- **Voice is batched on purpose.** Lines are written at most once an hour per pet
  (`VOICE_INTERVAL_MS`), and a failed try waits out the interval too. At most one remark on Claude's
  work every 3 minutes across all pets (`COMMENT_INTERVAL_MS`).
- **A voice prompt carries counts and session titles only**, never anything said in a session.
- **A pet file over 64 KiB is refused** before it is parsed (`MAX_IMPORT_BYTES`).
- **`pets.json` is its own file**, not a field in `settings.json`: a default written there can never
  be changed for anyone ([`src/main/CLAUDE.md`](../CLAUDE.md)).
- **A file from a newer Apiary is backed up** to `<file>.v<N>.bak` before this version rewrites it
  ([ADR-0012](../../../docs/adr/0012-one-versioned-json-store.md)).
