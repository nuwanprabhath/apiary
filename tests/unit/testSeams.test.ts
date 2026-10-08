import { describe, it, expect } from 'vitest'
import { parseTestSeams } from '../../src/renderer/state/testSeams'

describe('parseTestSeams', () => {
  it('reads the brain options and the flat flag out of a window URL', () => {
    const seams = { petBrainOptions: { sceneEveryMs: [100, 200], sceneKinds: ['catch', 'nonsense'] }, petsFlat: true }
    expect(parseTestSeams(`?w=1&seams=${encodeURIComponent(JSON.stringify(seams))}`)).toEqual({
      petBrainOptions: { sceneEveryMs: [100, 200], sceneKinds: ['catch'] },
      petsFlat: true,
    })
  })

  it('is empty for a URL with no seams, and for one whose seams are not what main writes', () => {
    expect(parseTestSeams('?w=1')).toEqual({})
    expect(parseTestSeams('?seams=not-json')).toEqual({})
    expect(parseTestSeams(`?seams=${encodeURIComponent('[1]')}`)).toEqual({})
    expect(parseTestSeams(`?seams=${encodeURIComponent(JSON.stringify({ petBrainOptions: { sceneEveryMs: ['x', 1] }, petsFlat: 'yes' }))}`)).toEqual({ petBrainOptions: {} })
  })
})
