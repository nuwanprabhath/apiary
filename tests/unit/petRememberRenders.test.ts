import { describe, expect, it, vi } from 'vitest'
import { rememberRenders } from '../../src/renderer/features/pets/render3d/rememberRenders'

describe('pet renders', () => {
  it('renders a look once and shares it with every later ask', async () => {
    const render = vi.fn(async (key: string) => `image of ${key}`)
    const get = rememberRenders(render)
    expect(await Promise.all([get('a'), get('a')])).toEqual(['image of a', 'image of a'])
    expect(await get('a')).toBe('image of a')
    expect(render).toHaveBeenCalledOnce()
  })

  it('tries a failed render again at once, and a second failure is not kept', async () => {
    const results: (string | null)[] = [null, null, 'image']
    const render = vi.fn(async () => results.shift() ?? null)
    const get = rememberRenders(render)
    expect(await get('a')).toBeNull()
    expect(render).toHaveBeenCalledTimes(2)
    expect(await get('a')).toBe('image')
    expect(render).toHaveBeenCalledTimes(3)
  })

  it('a render that fails once and then works is kept', async () => {
    const results: (string | null)[] = [null, 'image']
    const render = vi.fn(async () => results.shift() ?? null)
    const get = rememberRenders(render)
    expect(await get('a')).toBe('image')
    expect(await get('a')).toBe('image')
    expect(render).toHaveBeenCalledTimes(2)
  })
})
