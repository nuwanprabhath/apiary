import { describe, it, expect } from 'vitest'
import { loginShell, loginShellInvocation } from '../../src/main/exec/loginShell'

describe('loginShell', () => {
  it('prefers $SHELL', () => {
    expect(loginShell({ SHELL: '/usr/bin/zsh' })).toBe('/usr/bin/zsh')
  })

  it('falls back to bash', () => {
    expect(loginShell({})).toBe('/bin/bash')
    expect(loginShell({ SHELL: '  ' })).toBe('/bin/bash')
  })
})

describe('loginShellInvocation', () => {
  it('runs a command string as `$SHELL -l -c <command>`', () => {
    const inv = loginShellInvocation('exec claude --resume x', { parentEnv: { SHELL: '/usr/bin/zsh' } })
    expect(inv.file).toBe('/usr/bin/zsh')
    expect(inv.args).toEqual(['-l', '-c', 'exec claude --resume x'])
  })

  it('hands a binary and its arguments over as positional parameters, never parsed', () => {
    const inv = loginShellInvocation({ bin: 'claude', flags: ['-p'], positional: ['$(rm -rf ~)'] }, { shell: '/bin/sh', parentEnv: {} })
    expect(inv.file).toBe('/bin/sh')
    expect(inv.args).toEqual(['-l', '-c', 'exec "$0" "$@"', 'claude', '-p', '--', '$(rm -rf ~)'])
  })

  it('puts `--` before positional text, so a value that starts with "-" is not read as a flag', () => {
    const inv = loginShellInvocation({ bin: 'claude', flags: ['-p'], positional: ['--dangerously-skip-permissions'] }, { shell: '/bin/sh', parentEnv: {} })
    expect(inv.args.slice(4)).toEqual(['-p', '--', '--dangerously-skip-permissions'])
  })

  it('adds no `--` when there is no positional text', () => {
    const inv = loginShellInvocation({ bin: 'claude', flags: ['-p'] }, { shell: '/bin/sh', parentEnv: {} })
    expect(inv.args.slice(4)).toEqual(['-p'])
  })

  it("strips another session's markers, sets TERM, and adds the extras", () => {
    const inv = loginShellInvocation('x', { parentEnv: { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_USE_BEDROCK: '1' }, extraEnv: { A: 'b' } })
    expect(inv.env).toEqual({ PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1', TERM: 'xterm-256color', A: 'b' })
  })
})
