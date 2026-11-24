import { describe, expect, it, vi } from 'vitest'
import { STARTER_PET } from '@shared/pets/builtins'
import { renderLoop, type FromRenderer, type Renders } from '../../src/renderer/features/pets/render3d/renderLoop'
import type { PetImages } from '../../src/renderer/features/pets/render3d/render'

const IMAGES = { front: {}, side: {} } as unknown as PetImages

describe("the pet render worker's loop", () => {
  it('drops a renderer that failed, so a lost WebGL context does not fail every render after it', async () => {
    const lost: Renders = { render: () => Promise.reject(new Error('CONTEXT_LOST_WEBGL')), renderProps: () => Promise.reject(new Error('lost')) }
    const fresh: Renders = { render: () => Promise.resolve(IMAGES), renderProps: () => Promise.reject(new Error('unused')) }
    const make = vi.fn<() => Renders>().mockReturnValueOnce(lost).mockReturnValueOnce(fresh)
    const posted: FromRenderer[] = []
    const handle = renderLoop(make, (m) => { posted.push(m) })
    handle({ id: 1, spec: STARTER_PET })
    handle({ id: 2, spec: STARTER_PET })
    await vi.waitFor(() => { expect(posted).toHaveLength(2) })
    expect(posted[0]).toEqual({ id: 1, error: 'CONTEXT_LOST_WEBGL' })
    expect(posted[1]).toEqual({ id: 2, images: IMAGES })
    expect(make).toHaveBeenCalledTimes(2)
  })

  it('keeps a renderer that works', async () => {
    const make = vi.fn<() => Renders>(() => ({ render: () => Promise.resolve(IMAGES), renderProps: () => Promise.reject(new Error('unused')) }))
    const posted: FromRenderer[] = []
    const handle = renderLoop(make, (m) => { posted.push(m) })
    handle({ id: 1, spec: STARTER_PET })
    handle({ id: 2, spec: STARTER_PET })
    await vi.waitFor(() => { expect(posted).toHaveLength(2) })
    expect(make).toHaveBeenCalledTimes(1)
  })
})
