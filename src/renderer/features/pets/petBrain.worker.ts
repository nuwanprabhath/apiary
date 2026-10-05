import { Brain, type BrainEvent, type BrainOptions, type Command, type Scenery } from '@shared/pets/brain'

/**
 * The pets' brain, off the main thread (see `@shared/pets/brain`). It ticks four times a second
 * while the window is visible, and posts only when a pet should do something different — a few
 * small messages a minute. `pause` (the window hidden) stops the clock entirely.
 */
export type ToBrain = { type: 'init'; options: BrainOptions } | { type: 'event'; event: BrainEvent } | { type: 'pause' } | { type: 'resume' }
export interface FromBrain { commands: Command[]; scenery: Scenery[] }

const TICK_MS = 250
let brain = new Brain(Date.now() & 0x7fffffff)
const post = (commands: Command[]): void => {
  const scenery = brain.takeScenery()
  if (commands.length > 0 || scenery.length > 0) postMessage({ commands, scenery } satisfies FromBrain)
}
let timer: ReturnType<typeof setInterval> | null = null
let last = performance.now()
let hourAt = 0

function start(): void {
  if (timer !== null) return
  last = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    // A throttled timer (a busy machine) must not turn into one giant step.
    const dt = Math.min(1000, now - last)
    last = now
    if (now - hourAt > 60_000) {
      hourAt = now
      brain.handle({ kind: 'hour', hour: new Date().getHours() })
    }
    post(brain.tick(dt))
  }, TICK_MS)
}

function stop(): void {
  if (timer !== null) clearInterval(timer)
  timer = null
}

addEventListener('message', (e: MessageEvent<ToBrain>) => {
  const msg = e.data
  if (msg.type === 'init') brain = new Brain(Date.now() & 0x7fffffff, msg.options)
  else if (msg.type === 'pause') stop()
  else if (msg.type === 'resume') start()
  else post(brain.handle(msg.event))
})

brain.handle({ kind: 'hour', hour: new Date().getHours() })
start()
