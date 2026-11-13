import { describe, it, expect } from 'vitest'
import { CallbackPorts, callbackPortOf, CALLBACK_WINDOW_MS } from '../../src/main/remote/signInCallback'

const signIn = (redirect: string): string =>
  `https://claude.com/cai/oauth/authorize?code=true&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&state=s`

describe('a sign-in link\'s callback port', () => {
  it('is the localhost port its redirect_uri sends the browser back to (Claude Code\'s, as measured)', () => {
    expect(callbackPortOf(signIn('http://localhost:42987/callback'))).toBe(42987)
    expect(callbackPortOf(signIn('http://127.0.0.1:5000/cb'))).toBe(5000)
  })

  it('is none for the paste-a-code link, another host, https, or no redirect', () => {
    expect(callbackPortOf(signIn('https://platform.claude.com/oauth/code/callback'))).toBeNull()
    expect(callbackPortOf(signIn('http://example.com:8080/callback'))).toBeNull()
    expect(callbackPortOf(signIn('http://localhost/callback'))).toBeNull()
    expect(callbackPortOf('https://claude.com/x')).toBeNull()
    expect(callbackPortOf('not a url')).toBeNull()
  })

  it('may be relayed to only after one of this machine\'s terminals opened its link, and only for a while', () => {
    let now = 1000
    const ports = new CallbackPorts(() => now)
    expect(ports.allows(42987)).toBe(false)
    ports.note(signIn('http://localhost:42987/callback'))
    ports.note('https://example.com/plain')
    expect(ports.allows(42987)).toBe(true)
    expect(ports.allows(22)).toBe(false)
    now += CALLBACK_WINDOW_MS + 1
    expect(ports.allows(42987)).toBe(false)
  })
})
