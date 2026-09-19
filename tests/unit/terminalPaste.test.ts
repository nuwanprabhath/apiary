import { describe, it, expect } from 'vitest'
import { pasteText, type PasteableTerminal } from '../../src/renderer/state/terminalPaste'

/** Stands in for xterm's own `Terminal.paste()`: the one real write path, bracketing the text
 *  exactly the way xterm does when the running program has enabled bracketed-paste mode. */
class FakeTerminal implements PasteableTerminal {
  written: string[] = []
  bracketedPasteMode = false
  paste(text: string): void {
    this.written.push(this.bracketedPasteMode ? `\x1b[200~${text}\x1b[201~` : text)
  }
}

describe('pasteText', () => {
  it('writes the pasted text exactly once', () => {
    const term = new FakeTerminal()
    pasteText(term, 'hello world')
    expect(term.written).toEqual(['hello world'])
  })

  it('adds no literal bracketed-paste markers when the running program has not enabled that mode', () => {
    const term = new FakeTerminal()
    pasteText(term, 'hello world')
    expect(term.written.join('')).not.toContain('[200~')
    expect(term.written.join('')).not.toContain('[201~')
  })

  it('does bracket the text when the mode is on — that is xterm´s own job, left alone', () => {
    const term = new FakeTerminal()
    term.bracketedPasteMode = true
    pasteText(term, 'hello world')
    expect(term.written).toEqual(['\x1b[200~hello world\x1b[201~'])
  })

  it('does nothing for an empty clipboard, rather than writing a no-op paste', () => {
    const term = new FakeTerminal()
    pasteText(term, '')
    expect(term.written).toEqual([])
  })
})
