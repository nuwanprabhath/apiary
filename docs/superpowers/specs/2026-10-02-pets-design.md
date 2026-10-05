# Pets — design (1.31.0)

Small, bright, cute characters that live in the collapsed left rail and the bottom bar, wander
about on their own, react to what Claude is doing, and can be chatted with. Each pet is a data
file; Haiku (or another model the user picks) designs it, voices it and talks for it.

Also in 1.31.0: the composer's three-dot grip sits centred in the gap between the transcript and
the message box, not on the transcript's bottom line.

## Decisions (agreed with the user)

| Question | Decision |
| --- | --- |
| What is an installable pet? | A **data-only pet file** (`.apiarypet.json`). Apiary draws it from its own parts library; no markup or code from a pet ever runs. Same rule as themes and plugins. |
| How many at once? | Any number installed; **up to 3 active**. Active pets notice each other. |
| How chatty is Haiku? | **Batched voice.** Roughly hourly per active pet, one call produces ~20 in-character lines for the current situation; live calls only for chat. |
| Rendering | **Parametric SVG + CSS-transform animation + behaviour brain in a Web Worker.** |
| Size | 20–48 px (default 28). In the bar a pet's feet stay in the bar and a taller pet stands up over the content above it. |

## 1. The pet file (`src/shared/pets/`)

`spec.ts` defines `PetSpec`; `validate.ts`'s `validatePet(raw): PetSpec | null` is the only way
anything becomes one (mirrors `validateTheme`): own allowlisted properties only, closed sets for
every choice, colours accepted only as `#rgb`/`#rrggbb` and re-serialised, numbers clamped, text
trimmed, stripped of control characters and length-capped, arrays capped. Everything that reads a
pet validates again: the store on load and save, the generator on every reply, import.

```ts
interface PetSpec {
  version: 1
  name: string                 // ≤ 24 chars
  tagline: string              // one-line character, ≤ 120
  body: { shape: BodyShape; color: Hex; accent: Hex; texture: 'fuzzy' | 'glossy' | 'matte' }
  eyes: { style: 'round' | 'button' | 'sparkle' | 'sleepy' | 'wide'; color: Hex }
  cheeks: boolean
  arms: 'nub' | 'noodle' | 'mitten'
  legs: 'stubby' | 'feet' | 'boots'
  accessories: { kind: Accessory; color: Hex }[]   // ≤ 3, at most one per slot (head, face, neck)
  traits: { energy: number; curiosity: number; sleepiness: number; sociability: number } // 0..1
  lines: Partial<Record<Situation, string[]>>       // ≤ 12 per situation, ≤ 80 chars each
}
type BodyShape = 'blob' | 'bean' | 'drop' | 'heart' | 'star' | 'ghost' | 'puff' | 'cube'
type Accessory = 'beret' | 'cap' | 'beanie' | 'crown' | 'flower' | 'headphones'      // head
               | 'round-glasses' | 'sunglasses' | 'monocle'                          // face
               | 'bowtie' | 'scarf'                                                  // neck
type Situation = 'idle' | 'working' | 'finished' | 'waiting' | 'sleepy' | 'greet' | 'petted'
```

`prompt.ts` holds `buildPetPrompt({ description | null })`, `PET_JSON_SCHEMA` and
`buildVoicePrompt` / `buildChatPrompt`. `builtins.ts` holds one hand-made starter pet (used when
`claude` cannot be reached on first enable). File format on disk and for export is
`{ apiaryPet: 1, id, spec }`.

A pet's runtime record (not part of the shareable file), kept by `PetStore`:
`{ id, spec, model, size, active, place: { region: 'rail' | 'bar', at: 0..1 } | null, createdAt }`.

## 2. Main process (`src/main/pets/`)

- **`claude/claudeOneShot.ts`** — the safe `claude -p` launch extracted from `ThemeGenerator`
  (login shell, positional args, `--tools ""`, `--safe-mode`, `--strict-mcp-config`,
  `--no-session-persistence`, temp cwd, process group kill, timeout, stdout cap, cancel).
  `ThemeGenerator` and the pets use it; theme behaviour and its tests are unchanged.
- **`petStore.ts`** — one `userData/pets.json` (`{ version, enabled, pets }`, like `themes.json`),
  atomic writes, validates on load and save, drops (and logs) unreadable pets. Enforces "≤ 3 active".
- **`petService.ts`** — `generate(description|null, model)`, `voice(petId, situation context)`,
  `chat(petId, message)`; one claude process per pet at a time, chat history in memory (last 6
  exchanges), voice refresh at most hourly per pet, only while some window is visible and pets are
  enabled. Voice context is *counts and session titles* (working / finished / waiting), never
  transcript content. Every reply goes through `validatePet` / a line sanitiser.
- **On/off** lives in `pets.json`, not `settings.json` (main/CLAUDE.md: a default written into
  settings.json can never change). Default off; turning it on with no pets runs "Surprise me" once, falling back to
  the built-in starter if generation fails.
- **IPC** (contract + handlers + fake bridge + `ipcContract.test`): `petsState`, `petsChanged`
  event, `petGenerate`, `petGenerateCancel`, `petUpdate(id, {model?, size?, active?, place?, name?})`,
  `petDelete`, `petExport(id)` (save dialog), `petImport()` (open dialog), `petChat(id, text)`,
  `petVoice(id, context)`.

## 3. Renderer (`src/renderer/features/pets/`)

- **`PetSprite.tsx`** — draws a `PetSpec` as SVG from a parts library (`parts/*.tsx`: bodies,
  eyes, mouths, arms, legs, accessories). Pose and expression come from `data-pose` /
  `data-face` attributes; CSS swaps visible parts and runs the loops (blink, breathe, walk cycle,
  Zzz). Fuzzy texture is an SVG turbulence filter on the static body group; the animated element is
  its parent, `will-change: transform`, so the filter is rasterised once. Soft blurred ellipse
  shadow underneath. Memoised on spec + size.
- **`PetLayer.tsx`** — one `position: fixed; pointer-events: none` layer over the habitat; each
  pet's element has `pointer-events: auto`. Movement is a CSS `transform` transition whose duration
  is distance ÷ speed, so walking costs the main thread nothing per frame.
- **`habitat.ts`** (pure) — builds the L-shaped walkable path from the rail's and status bar's
  rects (measured with `ResizeObserver`): a vertical segment up the rail and a horizontal floor
  along the bar, joined at the corner. `toPoint(place)`, `nearest(point)`, `clamp`. When the
  sidebar is expanded the rail segment disappears and any pet on it climbs down.
- **`petBrain.worker.ts`** + **`brain.ts`** (pure, seeded RNG) — per pet: needs (energy, boredom,
  social) drifting each tick, weighted by traits and time of day; picks an activity — wander, run,
  sit, read, sleep, stretch, wave, dance, visit (another pet), watch (Claude) — and emits commands
  `{ petId, activity, to?: place, ms, face, say?: { text, kind: 'speech' | 'thought' } }`.
  Ticks at 4 Hz while visible; paused when the document is hidden; under reduced motion it emits
  only still poses (no walking). Events in: habitat changed, pet dragged/dropped, session started
  working (with the x of its pane, for eyes to look toward), turn finished, permission waiting,
  pets added/removed, line bank refreshed.
- **Interaction**: drag with pointer capture (pose "held", legs dangle), drop snaps to
  `habitat.nearest`, saved via `petUpdate(place)`. Right-click → `ContextMenu`: Chat…, Size
  (S 22 / M 28 / L 36 / XL 48), Sleep / Wake, Hide, Pet settings…. Click → chat bubble
  (`PetChat.tsx`): small popover anchored to the pet, input + last few exchanges.
- **Speech**: `PetBubble.tsx`, speech bubble or thought cloud, ~5 s, one at a time per pet, at
  most one every couple of minutes from the brain (chat replies excepted).
- **Settings → Pets** (`sections/PetsSection.tsx`, also listed under Plugins): enable toggle; grid
  of installed pets drawn live; per pet active (≤ 3), model (haiku default / sonnet / opus),
  rename, export, delete; "Describe a pet" textarea + Create, "Surprise me", Import….

## 4. The three-dot grip

`.composer-resize` is centred in the gap between the transcript's bottom edge and the composer's
top edge (its grip dots vertically centred in that gap), measured in the e2e.

## 5. Performance rules

- Nothing per frame on the main thread: no rAF loops, no JS-driven positions; only transform /
  opacity animate; the worker sends at most a few messages per second.
- Pets render nothing (and the worker is not started) while pets are disabled.
- Verified by a component test that counts layer re-renders over a simulated minute and by a bench
  run (`tests/e2e/bench`) comparing hover/scroll/typing frames with pets on vs off.

## 6. Testing

- Unit: `validatePet` (hostile / oversized / wrong-typed input, colour injection, unknown parts),
  `brain` (seeded runs: sleeps when tired, watches when a session works, visits when social, never
  leaves the habitat), `habitat` (points, nearest, rail removal), prompt builders.
- Integration: `petService` with a stand-in claude (generate, voice cadence, chat history, cancel),
  `PetStore` (≤ 3 active, bad files ignored), `claudeOneShot` (themeGenerator tests still pass).
- Component: `PetSprite` parts and faces for every shape/accessory; drag-and-snap; context menu
  resize; bubble timing; settings section.
- E2E: enabling generates a pet via the stand-in and it appears in the bar; drag to the rail;
  expanding the sidebar sends it back to the bar; resize; chat round-trip; export → import; grip
  position.

## Out of scope

Pets outside the habitat, sound, custom drawn art. A torn-off window shows the same active pets
in its own habitat (positions are shared, so they may jump when a window is resized).
