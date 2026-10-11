import { terminalRef } from '@shared/domain/ids'
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../src/main/vscode/detectVsCode', () => ({
  openInVsCode: vi.fn(),
  openFileInVsCode: vi.fn(),
}))

import { openFileInVsCode, openInVsCode } from '../../src/main/vscode/detectVsCode'
import { VsCodeService } from '../../src/main/vscode/vscodeService'
import { SessionResolver } from '../../src/main/sessions/sessionResolver'
import type { SessionStore } from '../../src/main/store/sessionStore'
import type { PtyManager } from '../../src/main/pty/ptyManager'

describe('VsCodeService.openMentionedFile', () => {
  const serviceIn = (dir: string, vsCodePath: string | null): VsCodeService => {
    const pty = { getCwd: () => dir } as unknown as PtyManager
    return new VsCodeService({ resolver: new SessionResolver({ store: {} as SessionStore, pty }), vsCodePath })
  }

  it('opens a file inside the session folder, at its line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-vscode-'))
    try {
      writeFileSync(join(dir, 'notes.md'), 'x')
      await serviceIn(dir, '/usr/bin/code').openMentionedFile(terminalRef('new:1', true), 'notes.md:3')
      expect(openFileInVsCode).toHaveBeenCalledWith('/usr/bin/code', expect.stringMatching(/notes\.md$/), 3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a file outside the folder, and opens nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-vscode-'))
    vi.mocked(openFileInVsCode).mockClear()
    try {
      await expect(serviceIn(dir, '/usr/bin/code').openMentionedFile(terminalRef('new:1', true), '../../etc/hosts')).rejects.toThrow()
      expect(openFileInVsCode).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects when VS Code was not found', async () => {
    await expect(serviceIn('/tmp', null).openMentionedFile(terminalRef('new:1', true), 'a.md')).rejects.toThrow('VS Code was not found')
  })
})

describe('VsCodeService: resolving without launching', () => {
  const serviceIn = (dir: string): VsCodeService => {
    const pty = { getCwd: () => dir } as unknown as PtyManager
    return new VsCodeService({ resolver: new SessionResolver({ store: {} as SessionStore, pty }), vsCodePath: null })
  }

  it('resolveFolder returns the session folder and resolveMentionedFile a file in it, launching nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-vscode-'))
    try {
      writeFileSync(join(dir, 'notes.md'), 'x')
      const service = serviceIn(dir)
      expect(service.resolveFolder(terminalRef('new:1', true))).toBe(dir)
      await expect(service.resolveMentionedFile(terminalRef('new:1', true), 'notes.md:3')).resolves.toEqual({ file: expect.stringMatching(/notes\.md$/) as string, line: 3 })
      await expect(service.resolveMentionedFile(terminalRef('new:1', true), '../../etc/hosts')).rejects.toThrow('not a file')
      expect(openInVsCode).not.toHaveBeenCalledWith(expect.anything(), dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

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
    await expect(service.open(terminalRef('s1', true))).rejects.toThrow('VS Code was not found on this machine')
  })

  it('open() resolves the cwd through the resolver and spawns VS Code there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-vscode-'))
    try {
      const pty = { getCwd: () => dir } as unknown as PtyManager
      const resolver = new SessionResolver({ store: {} as SessionStore, pty })
      const service = new VsCodeService({ resolver, vsCodePath: '/usr/bin/code' })
      await service.open(terminalRef('new:1', true))
      expect(openInVsCode).toHaveBeenCalledWith('/usr/bin/code', dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
