import { describe, it, expect } from 'vitest'
import { splitStreaming } from '../../src/renderer/features/chat/streamingSplit'

describe('splitStreaming', () => {
  it('keeps a reply with no paragraph break whole, as the tail', () => {
    expect(splitStreaming('The parser reads')).toEqual({ done: '', tail: 'The parser reads' })
  })

  it('splits at the last paragraph break', () => {
    expect(splitStreaming('one\n\ntwo\n\nthree')).toEqual({ done: 'one\n\ntwo\n\n', tail: 'three' })
  })

  it('does not split inside an open code fence', () => {
    const text = 'intro\n\n```ts\nconst a = 1\n\nconst b = 2'
    expect(splitStreaming(text)).toEqual({ done: 'intro\n\n', tail: '```ts\nconst a = 1\n\nconst b = 2' })
  })

  it('splits after a closed fence', () => {
    const text = '```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter'
    expect(splitStreaming(text)).toEqual({ done: '```ts\nconst a = 1\n\nconst b = 2\n```\n\n', tail: 'after' })
  })

  it('does not split a list that continues over a blank line', () => {
    const text = 'Steps:\n\n- one\n\n- two'
    const { done, tail } = splitStreaming(text)
    expect(done + tail).toBe(text)
    expect(tail).toBe('- one\n\n- two')
  })

  it('always loses nothing', () => {
    for (const text of ['', '\n\n', 'a\n\n', 'a\n\n\n\nb', '~~~\nx\n\ny']) {
      const { done, tail } = splitStreaming(text)
      expect(done + tail).toBe(text)
    }
  })
})
