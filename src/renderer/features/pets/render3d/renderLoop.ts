import type { PetSpec } from '@shared/pets/spec'
import { errorMessage } from '@shared/errors'
import type { PetImages, PropImages } from './render'

export type ToRenderer = { id: number; spec: PetSpec } | { id: number; props: true }
export type FromRenderer = { id: number; images: PetImages } | { id: number; props: PropImages } | { id: number; error: string }

/** What the loop needs of a `PetRenderer`. */
export interface Renders {
  render(spec: PetSpec): Promise<PetImages>
  renderProps(): Promise<PropImages>
}

/**
 * Renders one request at a time, each once. A renderer that failed is dropped and the next request
 * gets a new one: its WebGL context may be lost, and reusing it failed every render after, leaving
 * pets flat until a restart.
 */
export function renderLoop(make: () => Renders, post: (msg: FromRenderer) => void): (msg: ToRenderer) => void {
  let renderer: Renders | null = null
  let queue = Promise.resolve()
  return (msg) => {
    const id = msg.id
    queue = queue.then(async () => {
      try {
        renderer ??= make()
        if ('props' in msg) post({ id, props: await renderer.renderProps() })
        else post({ id, images: await renderer.render(msg.spec) })
      } catch (err) {
        renderer = null
        post({ id, error: errorMessage(err) })
      }
    })
  }
}
