import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { ChatManager } from '../../src/main/chat/chatManager'
import type { ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

const SESSION = asSessionId('11111111-2222-3333-4444-555555555555')

/** A child that never started: what `spawn` returns for a login shell that does not exist. */
function failedChild(): never {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    pid: undefined, kill: vi.fn(() => true),
  })
  setImmediate(() => { child.emit('error', Object.assign(new Error('spawn /nope ENOENT'), { code: 'ENOENT' })) })
  return child as never
}

describe('ChatManager when the process cannot be started (MAIN-19)', () => {
  it('ends the chat as exited with the reason, and stopAll still resolves', async () => {
    const states: ChatState[] = []
    const manager = new ChatManager({ claudeBin: () => 'claude', onChange: (s) => { states.push(s) }, spawn: failedChild })
    manager.start(SESSION, process.cwd())
    await vi.waitFor(() => { expect(states[states.length - 1]?.status).toBe('exited') })
    expect(states[states.length - 1]?.error).toContain('ENOENT')
    expect(manager.has(SESSION)).toBe(false)
    await expect(manager.stopAll()).resolves.toBeUndefined()
  })

  it('stopAll resolves even when it is called before the error has been delivered', async () => {
    const manager = new ChatManager({ claudeBin: () => 'claude', onChange: () => {}, spawn: failedChild })
    manager.start(SESSION, process.cwd())
    await expect(manager.stopAll()).resolves.toBeUndefined()
  })
})
