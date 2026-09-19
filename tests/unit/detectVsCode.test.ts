import { describe, it, expect } from 'vitest'
import { detectVsCode, openInVsCode } from '../../src/main/vscode/detectVsCode'

describe('detectVsCode', () => {
  it('uses `code` on PATH when it runs', async () => {
    const exec = async (file: string, args: string[]): Promise<string> => {
      expect(file).toBe('code')
      expect(args).toEqual(['--version'])
      return '1.90.0\nabc123\nx64'
    }
    expect(await detectVsCode({ exec })).toBe('code')
  })

  it('falls back to the macOS bundle path when `code` is not on PATH', async () => {
    const exec = async (): Promise<string> => { throw new Error('command not found') }
    const exists = (path: string): boolean =>
      path === '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    expect(await detectVsCode({ platform: 'darwin', exec, exists })).toBe(
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    )
  })

  it('falls back to a known Linux package path', async () => {
    const exec = async (): Promise<string> => { throw new Error('command not found') }
    const exists = (path: string): boolean => path === '/usr/share/code/bin/code'
    expect(await detectVsCode({ platform: 'linux', exec, exists })).toBe('/usr/share/code/bin/code')
  })

  it('resolves to null when nothing is found', async () => {
    const exec = async (): Promise<string> => { throw new Error('command not found') }
    const exists = (): boolean => false
    expect(await detectVsCode({ platform: 'darwin', exec, exists })).toBeNull()
  })

  it('runs the detection only once per call site — repeat calls with a spy exec see it twice, caching is the caller\'s job', async () => {
    let calls = 0
    const exec = async (): Promise<string> => { calls++; return '1.90.0' }
    await detectVsCode({ exec })
    await detectVsCode({ exec })
    expect(calls).toBe(2)
  })
})

describe('openInVsCode', () => {
  it('spawns the resolved binary with the folder as a plain argument, never through a shell', () => {
    const calls: Array<{ command: string; args: string[]; options: unknown }> = []
    const spawn = (command: string, args: string[], options: unknown): { unref: () => void } => {
      calls.push({ command, args, options })
      return { unref: () => {} }
    }
    openInVsCode('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '/repo/work', { spawn: spawn as never })
    expect(calls).toEqual([{
      command: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      args: ['/repo/work'],
      options: { detached: true, stdio: 'ignore', shell: false },
    }])
  })

  it('throws when spawning itself fails, so the caller can report it', () => {
    const spawn = (): never => { throw new Error('EACCES') }
    expect(() => openInVsCode('code', '/repo/work', { spawn: spawn as never })).toThrow('EACCES')
  })
})
