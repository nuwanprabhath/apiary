# Pets

Read with root CLAUDE.md. Pets are small characters that live along the window's edge: on the
status bar's free stretch and up the collapsed sidebar's rail (`habitat.ts`). They wander, nap,
read and react to Claude, and you can drag, resize, put away and chat with them.

## A pet is data, never code

`PetSpec` (`spec.ts`) chooses parts from closed sets (body shape, texture, eyes, arms, legs, up to
three accessories, one per slot) plus colours, traits and lines. Apiary draws every pet itself:
in 3D from `renderer/features/pets/render3d/`, or flat from `parts.tsx` where WebGL is
unavailable. **`validatePet` is the only way in**: replies from Claude, imported `.apiarypet.json` files and `pets.json` all go through it. It reads only allowlisted own
properties and accepts colours only as plain `#rgb`/`#rrggbb`, because they end up in SVG
attributes. Text is capped, stripped of control characters and only ever drawn as text. A new part
is a new entry in a closed set plus its drawing in both `src/renderer/features/pets/render3d/parts3d.ts` and `parts.tsx`. It never comes from a pet's own
markup.

## Where things live

- `main/pets/petStore.ts` keeps `pets.json` in userData, with on/off, every pet and where it stands.
  It is separate from `settings.json` for the reason in main/CLAUDE.md: a default can't change once
  it has been written there.
- `main/pets/petService.ts` asks the user's `claude -p` (`main/claude/claudeOneShot.ts`, shared with
  the theme designer) to:
  - design a pet;
  - write its lines for the hour, at most hourly per pet, from session counts and titles only;
  - chat, keeping the last 6 turns in memory.
- Each kind of call has its own runner. Nothing a pet or the user says is logged.
- On first enable it hatches one; when that fails it falls back to `STARTER_PET`.
- `brain.ts` decides behaviour. It is pure and seeded, and runs in a Web Worker
  (`renderer/features/pets/petBrain.worker.ts`), ticking 4 times a second while the window is
  visible.
  - Each pet has needs (energy, boredom, social) weighted by its traits.
  - It reacts to Claude: it watches while a session works, celebrates when a turn finishes, and gets
    nervous when one waits on you.
  - It sends a few commands a minute; the page turns them into CSS transitions.

## What pets may know about Claude's work

When a pet remarks on what Claude is doing, its model is told **the action only**, as the user
chose: the latest tool's name and its label, from `latestAction` (`actions.ts`). That's a Bash
call's description, a file's base name, or a helper's task. It is never the command, never output,
never a file's contents, never anything said. A search pattern, URL or query counts as content, so
it is reduced to a verb ("searching the code"). There is at most one remark every 3 minutes across
all pets (`PetService.comment`), and only while a session is working.

## Life: scenes, props and errands (brain.ts)

- **Errands.** When a session finishes, the nearest awake pet runs to the spot on the bar under
  that pane (`data-session-key` on `session-column`) and points at it. While Claude works, a curious
  pet walks under the working pane every 3–5 minutes and asks for a remark (`Command.ask`).
- **Alone.** A pet can use a laptop, exercise, eat, drink, skip, paint at an easel or skateboard
  along the bar (never up the rail), each with a 3D prop.
- **Scenes.** Every 10–20 minutes the brain puts on a scene for about a minute:
  - catch or tennis (a ball flies between two pets);
  - sharing a snack, or a picnic;
  - fishing at a pond, or reading under a tree, where a friend may join;
  - a drive, or a parachute jump off the rail (only while the rail is out).

  Each scene reserves its stretch of the bar, and other pets keep out of it. Scenery and the ball
  come out through `takeScenery()`, and the page draws them behind the pets (`SceneryLayer`).
  There are no scenes under reduced motion.
- **Props and scenery** are built in `src/renderer/features/pets/render3d/props.ts`.
  - Held props use the pets' camera frame, so one image fits any pet.
  - Scenery uses frames of its own, with their constants in `src/renderer/features/pets/render3d/frames.ts`. That file
    doesn't import three.js, which only the worker loads.
  - Props render once, and the render is kept.
- **Test seams.** `petBrainOptions` makes scenes and remarks come round in seconds (`sceneKinds`
  picks which scenes play); `petsFlat` skips 3D in component tests. Both live in
  `src/renderer/state/testSeams.ts`, set by `setTestSeams` in a component test or by
  `APIARY_RENDERER_SEAMS` in an e2e run, and inert in a packaged build.

## How a pet is drawn: 3D, rendered once

Pets are rendered in 3D with three.js (`renderer/features/pets/render3d/`), but **never per
frame**:

- **Rendering.** A worker (`petRender.worker.ts`, OffscreenCanvas) renders each pet once into
  transparent PNG layers, all with the same camera so they line up:
  - the body;
  - one face per expression;
  - what it wears;
  - each arm and leg.

  A layer that sits on the body is rendered with the body as an invisible depth-only occluder, so
  whatever is behind the body is cut away. The page stacks the layers and animates them with the
  same CSS as before.
- **Two views.** Every pet is rendered from the front and in profile, turned `SIDE_TURN` (58°) to
  face right; the page mirrors it to face left.
  - **Which view.** `viewOf` in `PetSprite.tsx` chooses. Typing, eating, drinking, fishing and
    painting are always side-on. Walking, running, carrying, driving and skating are side-on on
    the bar, but face the window on the rail, where a pet moves up and down.
  - **Not fully side-on.** A pure profile of a round plush is a ball with a bump; 58° keeps the
    near eye on the face.
  - **Arms and legs.** In profile the near arm and leg (`L`) stack in front of the far ones. Side
    arms hang straight down from a shoulder further round the front (`sideShoulder`), so a CSS
    rotation swings them forward, towards what the pet holds.
  - **Props.** Each prop is rendered for one view (`PROP_VIEW` in `frames.ts`). Side props are
    built facing +z, as the pet faces, and turned with it. A prop is shown only in its own view.
- **Bodies** are signed distance functions (`sdf.ts`): smooth unions of ellipsoids, meshed by
  marching cubes. Normals must be normalised before they are used (`meshFromSdf`); unnormalised
  ones made the underside of every body black.
- **Fur** uses shells (`plush.ts`): the mesh drawn ~32 times, each copy pushed out along its
  normals. The inner shells are darker, and fibres are cut from a pcg3d hash. A float hash built
  on x·y·z went bald along y = 0.
- **Lighting:** a room environment for reflections, plus a warm key light, a strong rim light
  (what makes felt glow at its edge) and a catch-light for glossy eyes.
- **Cost.** On a real GPU, three pets render in about 2 s in the background. Software WebGL in
  the component tests is much slower. Renders are kept in IndexedDB keyed by the pet's look and
  `RENDER_VERSION`, so the next launch shows them at once. Bump `RENDER_VERSION` whenever the
  output changes.
- **Fallbacks.** While a render is pending the pet is hidden, so it never flips from flat to 3D in
  front of you. Where WebGL cannot be had, the flat SVG version (`parts.tsx`) is drawn in the same
  layers.

## Performance rules, measured

- **Every moving part is an HTML layer holding an image or an SVG.** Chromium composites a transform animation
  on an HTML element, but repaints the whole SVG every frame for one on an element inside it. So
  breathing, blinking and walking run on the compositor, and the SVGs repaint only when a pet's pose
  changes.
- **No per-frame JavaScript.** A walk is a `transform` transition lasting `distance ÷ speed`. A drag
  writes the transform straight onto the element, with no React render per pointer move.
- **Measured:** three pets touch the DOM about 30 times in 5 seconds
  (`tests/component/petLayer.test.tsx` keeps this under 150).
- **When pets are off, or none is out, nothing mounts:** no layer, no worker, no timers.
