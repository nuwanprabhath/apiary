import { describe, it, expect } from 'vitest'
import { describeError } from '../../src/renderer/errors'

describe('describeError', () => {
  it('strips the IPC plumbing an Electron invoke wraps a main-process failure in', () => {
    // Verbatim shape of what `ipcRenderer.invoke` rejects with — the reason the reported
    // failure was unreadable even when it did reach the screen.
    const thrown = new Error(
      "Error invoking remote method 'apiary:transcript': Error: ENOENT: no such file or " +
      "directory, stat '/Users/x/.claude/projects/-p/abc.jsonl'",
    )
    const { message } = describeError(thrown)
    expect(message).toBe(
      'No such file or directory: /Users/x/.claude/projects/-p/abc.jsonl',
    )
    expect(message).not.toContain('Error invoking remote method')
    expect(message).not.toContain('ENOENT')
  })

  it('leaves a message that already reads as a sentence alone', () => {
    const { message } = describeError(new Error('The folder for this session no longer exists: /gone'))
    expect(message).toBe('The folder for this session no longer exists: /gone')
  })

  it('keeps the stack as detail, and does not repeat a message that carries no stack', () => {
    const withStack = new Error('boom')
    withStack.stack = 'Error: boom\n    at somewhere'
    expect(describeError(withStack).detail).toBe('Error: boom\n    at somewhere')

    const withoutStack = new Error('boom')
    withoutStack.stack = undefined
    expect(describeError(withoutStack).detail).toBeNull()
  })

  it('still says something useful when what was thrown is not an Error at all', () => {
    expect(describeError('plain string failure').message).toBe('plain string failure')

    const odd = describeError({ code: 7 })
    expect(odd.message).toBe('Something went wrong.')
    expect(odd.detail).toBe('{"code":7}')
  })

  it('never returns an empty headline', () => {
    expect(describeError(new Error('')).message).toBe('Something went wrong.')
    expect(describeError(new Error('Error: ')).message).toBe('Something went wrong.')
  })
})

describe('describeError headlines', () => {
  it('keeps only the first line of an essay-length failure, with the rest as detail', () => {
    // git's actual "no remote" output — four lines, indented example commands and all.
    const thrown = new Error(
      'fatal: No configured push destination.\n' +
      'Either specify the URL from the command-line or configure a remote repository using\n' +
      '\n    git remote add <name> <url>\n\n' +
      'and then push using the remote name\n\n    git push <name>\n',
    )
    thrown.stack = undefined
    const { message, detail } = describeError(thrown)
    expect(message).toBe('fatal: No configured push destination.')
    expect(detail).toContain('git remote add <name> <url>')
  })

  it('truncates a single line that is simply too long, rather than wrapping forever', () => {
    const long = new Error('x'.repeat(400))
    long.stack = undefined
    const { message, detail } = describeError(long)
    expect(message.length).toBeLessThanOrEqual(161)
    expect(message.endsWith('…')).toBe(true)
    expect(detail).toBe('x'.repeat(400))
  })
})
