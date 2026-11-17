import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeCarriedInput, readTypedInput, type ScreenLine } from '@shared/typedInput'
import { renderStyledScreen } from '../../src/main/pty/screen'

const FIXTURES = join(__dirname, '..', 'fixtures')

async function typedIn(fixture: string): Promise<string | null> {
  const lines = await renderStyledScreen(readFileSync(join(FIXTURES, fixture), 'utf8'), 120, 40)
  return readTypedInput(lines, 120)
}

const plain = (...texts: string[]): ScreenLine[] => texts.map((text) => [{ text, dim: false }])
const RULE = '─'.repeat(120)

describe('readTypedInput on recorded Claude Code screens', () => {
  it('reads an empty box showing the dim placeholder hint as nothing typed', async () => {
    expect(await typedIn('typed-input/empty-placeholder.txt')).toBeNull()
  })

  it('reads one typed line without the prompt marker', async () => {
    expect(await typedIn('typed-input/one-line.txt')).toBe('You can use this worktree related to #2779.')
  })

  it('joins a line Claude Code wrapped back into one, with a space', async () => {
    expect(await typedIn('typed-input/wrapped.txt')).toBe(
      'This is a long message that keeps going well past the width of the terminal so that Claude Code has to wrap it onto a second line of its input box.',
    )
  })

  it('keeps a newline typed into the box', async () => {
    expect(await typedIn('typed-input/two-lines.txt')).toBe('first line\nsecond line')
  })

  it('reads what is typed while Claude is still answering', async () => {
    expect(await typedIn('typed-input/running.txt')).toBe('next I want to ask about ptys')
  })

  it('carries nothing from a permission prompt', async () => {
    expect(await typedIn('activity/permission-prompt.txt')).toBeNull()
  })
})

describe('mergeCarriedInput', () => {
  it('puts the text into an empty draft', () => {
    expect(mergeCarriedInput('', 'hi')).toBe('hi')
  })

  it('appends on a new line to a draft that does not end with it', () => {
    expect(mergeCarriedInput('first\n', 'hi')).toBe('first\nhi')
  })

  it('leaves a draft that already ends with the text', () => {
    expect(mergeCarriedInput('first\nhi', 'hi')).toBe('first\nhi')
  })
})

describe('readTypedInput on screens that are not the input box', () => {
  it('reads a shell prompt as nothing', () => {
    expect(readTypedInput(plain('$ ls', 'a b', '> echo hi'), 120)).toBeNull()
  })

  it('reads an option cursor framed by rules as nothing', () => {
    expect(readTypedInput(plain(RULE, '❯ 1. Yes', '  2. No', RULE), 120)).toBeNull()
  })

  it('reads a box with no bottom rule as nothing', () => {
    expect(readTypedInput(plain(RULE, '❯ hello'), 120)).toBeNull()
  })
})
