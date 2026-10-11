import { describe, expect, it } from 'vitest'
import { describeSshFailure, isLoginRefused } from '../../src/main/remote/sshCommand'

const TAILSCALE = 'tailscale: tailnet policy does not permit you to SSH as user "nuwan"'

describe("ssh's failures, as the connect dialog says them", () => {
  it('a refused login is not an unreachable machine', () => {
    expect(isLoginRefused('dev@box: Permission denied (publickey).')).toBe(true)
    expect(isLoginRefused(TAILSCALE)).toBe(true)
    expect(isLoginRefused('ssh: connect to host box port 22: Operation timed out')).toBe(false)
    expect(isLoginRefused('ssh: Could not resolve hostname box: nodename nor servname provided')).toBe(false)
  })

  it("names the user Tailscale refused and how to log in as one the machine has, never Tailscale's bare line", () => {
    const text = describeSshFailure(TAILSCALE, 'work-box.tail1.ts.net')
    expect(text).toContain('as "nuwan"')
    expect(text).toContain('type user@work-box.tail1.ts.net')
    expect(text).toContain('"User" line for work-box.tail1.ts.net to ~/.ssh/config')
    expect(text).not.toContain('tailscale:')
  })

  it('suggests user@ the machine, not user@ the user@host that was typed', () => {
    const text = describeSshFailure(TAILSCALE.replace('nuwan', 'root'), 'root@box')
    expect(text).toContain('type user@box,')
    expect(text).not.toContain('user@root@box')
  })

  it('keeps the other sentences', () => {
    expect(describeSshFailure('', 'box', true)).toBe('box did not answer.')
    expect(describeSshFailure('ssh: Could not resolve hostname box: x', 'box')).toBe('No machine called box was found.')
    expect(describeSshFailure('Permission denied (publickey).', 'box')).toMatch(/^SSH refused the login to box/)
  })
})
