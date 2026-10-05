import type { BrainEvent, BrainOptions } from '@shared/pets/brain'
import type { FromBrain, ToBrain } from './petBrain.worker'

/**
 * The page's end of the pets' brain: one worker, events in, commands out. Started only while pets
 * are on and some are out; paused while the window is hidden.
 */
export class BrainClient {
  private readonly worker: Worker

  constructor(onMessage: (m: FromBrain) => void) {
    this.worker = new Worker(new URL('./petBrain.worker.ts', import.meta.url), { type: 'module', name: 'pets' })
    this.worker.addEventListener('message', (e: MessageEvent<FromBrain>) => { onMessage(e.data) })
    // Test seam: tests make scenes and remarks come round in seconds rather than minutes.
    const options = (globalThis as Record<string, unknown>).__apiaryPetBrainOptions as BrainOptions | undefined
    if (options !== undefined) this.post({ type: 'init', options })
  }

  send(event: BrainEvent): void { this.post({ type: 'event', event }) }
  pause(): void { this.post({ type: 'pause' }) }
  resume(): void { this.post({ type: 'resume' }) }
  dispose(): void { this.worker.terminate() }

  private post(msg: ToBrain): void { this.worker.postMessage(msg) }
}
