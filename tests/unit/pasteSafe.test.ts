import { describe, it, expect } from 'vitest'
import { stripPasteControls } from '@shared/pasteSafe'

describe('stripPasteControls', () => {
  it('removes an ESC that would close a bracketed paste early', () => {
    // SEC-6: an ESC[201~ inside the payload ends the bracket, and whatever follows arrives as
    // keystrokes — a bare \r submits it, a leading ! puts Claude Code into bash mode.
    const stripped = stripPasteControls('a\x1b[201~\r!x')
    expect(stripped).not.toContain('\x1b')
  })

  it('leaves ordinary text untouched', () => {
    expect(stripPasteControls('hello\nworld')).toBe('hello\nworld')
  })
})
