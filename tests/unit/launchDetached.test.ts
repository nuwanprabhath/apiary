import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { launchDetached } from '../../src/main/exec/launchDetached'
import { log } from '../../src/main/log/logger'

describe('launchDetached', () => {
  it('spawns detached with no stdio and no shell, then unrefs', () => {
    const unref = vi.fn()
    const spawn = vi.fn(() => Object.assign(new EventEmitter(), { unref }) as unknown as ChildProcess)
    launchDetached('code', ['/repo'], 'vscode', spawn)
    expect(spawn).toHaveBeenCalledWith('code', ['/repo'], { detached: true, stdio: 'ignore', shell: false })
    expect(unref).toHaveBeenCalled()
  })

  it("logs a failed launch instead of letting the child's 'error' event reach main uncaught", () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    const child = new EventEmitter()
    launchDetached('code', ['/repo'], 'vscode', () => child as unknown as ChildProcess)
    expect(() => child.emit('error', new Error('ENOENT'))).not.toThrow()
    expect(warn).toHaveBeenCalledWith('vscode', 'launch failed', { command: 'code', error: 'ENOENT' })
    warn.mockRestore()
  })

  it('lets a synchronous spawn failure reach the caller', () => {
    expect(() => launchDetached('code', [], 'vscode', () => { throw new Error('EACCES') })).toThrow('EACCES')
  })
})
