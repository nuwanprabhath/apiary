import { describe, it, expect } from 'vitest'
import { lastPathSegment } from '@shared/text'

describe('lastPathSegment', () => {
  it('is the last part of a path with either separator, ignoring a trailing one', () => {
    expect(lastPathSegment('/Users/me/projects/core')).toBe('core')
    expect(lastPathSegment('/Users/me/projects/core/')).toBe('core')
    expect(lastPathSegment('C:\\work\\wildobs')).toBe('wildobs')
    expect(lastPathSegment('notes.md')).toBe('notes.md')
  })

  it('is empty for an empty path or only separators', () => {
    expect(lastPathSegment('')).toBe('')
    expect(lastPathSegment('/')).toBe('')
  })
})
