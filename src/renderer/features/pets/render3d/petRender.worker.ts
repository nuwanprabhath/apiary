import type { PetSpec } from '@shared/pets/spec'
import { PetRenderer, RENDER_PX, type PetImages, type PropImages } from './render'

/**
 * Renders pets off the main thread, on an OffscreenCanvas: one at a time, each once. A pet's
 * fur is a few thousand draw calls; none of them is the page's business.
 */
export type ToRenderer = { id: number; spec: PetSpec } | { id: number; props: true }
export type FromRenderer = { id: number; images: PetImages } | { id: number; props: PropImages } | { id: number; error: string }

let renderer: PetRenderer | null = null
let queue = Promise.resolve()

addEventListener('message', (e: MessageEvent<ToRenderer>) => {
  const msg = e.data
  const id = msg.id
  queue = queue.then(async () => {
    try {
      renderer ??= new PetRenderer(new OffscreenCanvas(RENDER_PX, RENDER_PX))
      if ('props' in msg) postMessage({ id, props: await renderer.renderProps() } satisfies FromRenderer)
      else postMessage({ id, images: await renderer.render(msg.spec) } satisfies FromRenderer)
    } catch (err) {
      postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies FromRenderer)
    }
  })
})
