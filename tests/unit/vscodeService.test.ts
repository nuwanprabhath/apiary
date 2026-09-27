import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/main/vscode/detectVsCode', () => ({
  openInVsCode: vi.fn(),
}))

import { openInVsCode } from '../../src/main/vscode/detectVsCode'
import { VsCodeService } from '../../src/main/vscode/vscodeService'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import type { SessionStore } from '../../src/main/store/sessionStore'
import type { PtyManager } from '../../src/main/pty/ptyManager'

describe('VsCodeService', () => {
  it('available() is false when no VS Code path was found', () => {
    const resolver = new SessionResolver({ store: {} as SessionStore, pty: {} as PtyManager })
    const service = new VsCodeService({ resolver, vsCodePath: null })
    expect(service.available()).toBe(false)
  })

  it('available() is true when a VS Code path was found', () => {
    const resolver = new SessionResolver({ store: {} as SessionStore, pty: {} as PtyManager })
    const service = new VsCodeService({ resolver, vsCodePath: 'code' })
    expect(service.available()).toBe(true)
  })

  it('open() rejects when VS Code was not found', async () => {
    const resolver = new SessionResolver({ store: {} as SessionStore, pty: {} as PtyManager })
    const service = new VsCodeService({ resolver, vsCodePath: null })
    await expect(service.open('s1', true)).rejects.toThrow('VS Code was not found on this machine')
  })

  it('open() resolves the cwd through the resolver and spawns VS Code there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-vscode-'))
    try {
      const pty = { getCwd: () => dir } as unknown as PtyManager
      const resolver = new SessionResolver({ store: {} as SessionStore, pty })
      const service = new VsCodeService({ resolver, vsCodePath: '/usr/bin/code' })
      await service.open('new:1', true)
      expect(openInVsCode).toHaveBeenCalledWith('/usr/bin/code', dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
