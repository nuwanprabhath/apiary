import { describe, expect, it } from 'vitest'
import { wordRangeAt } from '../../src/renderer/features/spelling/wordRange'

describe('wordRangeAt', () => {
  it('finds the word the caret is in, or at the end of', () => {
    expect(wordRangeAt('teh cat', 1)).toEqual({ start: 0, end: 3, word: 'teh' })
    expect(wordRangeAt('teh cat', 3)).toEqual({ start: 0, end: 3, word: 'teh' })
    expect(wordRangeAt('teh cat', 5)).toEqual({ start: 4, end: 7, word: 'cat' })
  })

  it('keeps an apostrophe inside a word', () => {
    expect(wordRangeAt("don't stop", 2)).toEqual({ start: 0, end: 5, word: "don't" })
  })

  it('splits at a hyphen', () => {
    expect(wordRangeAt('well-known', 2)).toEqual({ start: 0, end: 4, word: 'well' })
  })

  it('returns null when the caret touches no word', () => {
    expect(wordRangeAt('teh  cat', 4)).toBeNull()
    expect(wordRangeAt('', 0)).toBeNull()
  })

  it('takes letters beyond ASCII as part of a word', () => {
    expect(wordRangeAt('café au', 2)).toEqual({ start: 0, end: 4, word: 'café' })
  })
})
