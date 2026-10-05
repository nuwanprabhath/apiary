import type { PetSpec } from './spec'

/**
 * The pet someone gets when their first one cannot be designed — `claude` missing, signed out, or
 * offline. Turning pets on should never end in an empty bar.
 */
export const STARTER_PET: PetSpec = {
  version: 1,
  name: 'Pip',
  tagline: 'A fuzzy blue blob in a beret who thinks every commit is a tiny masterpiece.',
  body: { shape: 'blob', color: '#2f7bff', accent: '#6fb1ff', texture: 'fuzzy' },
  eyes: { style: 'round', color: '#10121c' },
  cheeks: true,
  arms: 'nub',
  legs: 'stubby',
  accessories: [{ kind: 'beret', color: '#1b1b24' }],
  traits: { energy: 0.6, curiosity: 0.8, sleepiness: 0.4, sociability: 0.7 },
  lines: {
    idle: ['Ooh, what are we making?', 'I could watch diffs all day.', 'Is it snack o\'clock?', '*hums a little tune*'],
    working: ['Go Claude, go!', 'Look at it think!', 'Tiny keyboard noises…', 'I believe in you, Claude.'],
    finished: ['Ta-da! It\'s done!', 'Another masterpiece.', 'Bravo! Encore!'],
    waiting: ['Psst… Claude needs you.', 'Someone\'s asking for permission!', 'Ahem. A question awaits.'],
    sleepy: ['Just resting my eyes…', 'Zzz… merge conflicts… zzz', '*yawns*'],
    greet: ['Oh hi friend!', 'Fancy meeting you here!', 'High five!'],
    petted: ['Hehe, that tickles!', 'Again! Again!', '*happy wiggle*'],
  },
}
