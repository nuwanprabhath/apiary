import { describe, it, expect } from 'vitest'
import { parseMrRefs } from '../../src/shared/mrRefs'

describe('parseMrRefs', () => {
  it('finds a bare reference', () => {
    expect(parseMrRefs('fixes !1267 today')).toEqual([{ iid: 1267, index: 6 }])
  })

  it('finds more than one', () => {
    expect(parseMrRefs('!12 and !345')).toEqual([
      { iid: 12, index: 0 },
      { iid: 345, index: 8 },
    ])
  })

  it('ignores a reference glued to a word', () => {
    expect(parseMrRefs('see foo!12 for context')).toEqual([])
  })

  it('ignores a reference followed by more word characters', () => {
    expect(parseMrRefs('build !12a failed')).toEqual([])
  })

  it('ignores one that falls inside a URL', () => {
    const text = 'https://gitlab.com/group/project/-/merge_requests/1267?x=!123'
    expect(parseMrRefs(text)).toEqual([])
  })

  it('still finds a real reference next to a URL', () => {
    const text = 'see https://gitlab.com/group/project !1267'
    expect(parseMrRefs(text)).toEqual([{ iid: 1267, index: 37 }])
  })

  it('returns nothing for text with no reference', () => {
    expect(parseMrRefs('just a normal title')).toEqual([])
  })
})
