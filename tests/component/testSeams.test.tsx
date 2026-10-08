import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrainClient } from '../../src/renderer/features/pets/brainClient'
import { setTestSeams } from '../../src/renderer/state/testSeams'

/**
 * The pets' test seams are inert unless they come through `state/testSeams.ts` (a window URL main
 * only writes when tests are on, or a component test). A property on `globalThis`, which any
 * script in the page can set, used to switch them in production.
 */
describe('renderer test seams', () => {
  afterEach(() => {
    setTestSeams({ petBrainOptions: undefined })
    delete (globalThis as Record<string, unknown>).__apiaryPetBrainOptions
    vi.restoreAllMocks()
  })

  function initMessagesFor(make: () => void): unknown[] {
    const post = vi.spyOn(Worker.prototype, 'postMessage')
    make()
    return post.mock.calls.map((call): unknown => call[0]).filter((m) => (m as { type?: string }).type === 'init')
  }

  it('a __apiaryPetBrainOptions global set by a script changes nothing', () => {
    (globalThis as Record<string, unknown>).__apiaryPetBrainOptions = { sceneEveryMs: [1, 2] }
    const client: BrainClient[] = []
    expect(initMessagesFor(() => { client.push(new BrainClient(() => {})) })).toEqual([])
    client[0].dispose()
  })

  it('options set through the sanctioned seam reach the brain', () => {
    setTestSeams({ petBrainOptions: { sceneEveryMs: [1, 2] } })
    const client: BrainClient[] = []
    expect(initMessagesFor(() => { client.push(new BrainClient(() => {})) })).toEqual([{ type: 'init', options: { sceneEveryMs: [1, 2] } }])
    client[0].dispose()
  })
})
