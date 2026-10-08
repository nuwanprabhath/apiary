import { describe, it, expect } from 'vitest'
import { isTrustedRendererUrl, isTrustedSender, UNCHECKED_SENDERS } from '../../src/main/ipc/ipcSenderGuard'

describe('isTrustedRendererUrl', () => {
  it('accepts a packaged renderer URL regardless of its window-number query', () => {
    const expected = { devServerOrigin: null }
    expect(isTrustedRendererUrl('file:///Applications/Apiary.app/Contents/Resources/app/out/renderer/index.html?w=1', expected)).toBe(true)
    expect(isTrustedRendererUrl('file:///Applications/Apiary.app/Contents/Resources/app/out/renderer/index.html?w=2&detach=k', expected)).toBe(true)
  })

  it('refuses a file:// URL that is not the renderer entry point', () => {
    const expected = { devServerOrigin: null }
    expect(isTrustedRendererUrl('file:///etc/passwd', expected)).toBe(false)
    expect(isTrustedRendererUrl('file:///Applications/Apiary.app/Contents/Resources/app/out/renderer/other.html', expected)).toBe(false)
  })

  it('refuses an http(s) URL when not configured for a dev server', () => {
    expect(isTrustedRendererUrl('https://example.com/', { devServerOrigin: null })).toBe(false)
  })

  it('accepts only the configured dev-server origin, any path or query', () => {
    const expected = { devServerOrigin: 'http://localhost:5173' }
    expect(isTrustedRendererUrl('http://localhost:5173/?w=1', expected)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/index.html?w=2', expected)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:9999/?w=1', expected)).toBe(false)
    expect(isTrustedRendererUrl('http://evil.example/?w=1', expected)).toBe(false)
  })

  it('refuses an unparseable URL', () => {
    expect(isTrustedRendererUrl('not a url', { devServerOrigin: null })).toBe(false)
  })
})

describe('isTrustedSender', () => {
  const expected = { devServerOrigin: null }

  it('denies a missing sender frame: Electron sets senderFrame to null for a destroyed frame', () => {
    expect(isTrustedSender(undefined, expected)).toBe(false)
    expect(isTrustedSender(null, expected)).toBe(false)
    expect(isTrustedSender(undefined, { devServerOrigin: 'http://localhost:5173' })).toBe(false)
  })

  it('defers to isTrustedRendererUrl when there is a url', () => {
    expect(isTrustedSender('file:///a/renderer/index.html', expected)).toBe(true)
    expect(isTrustedSender('https://evil.example/', expected)).toBe(false)
  })

  it('checks nothing only when the caller explicitly opted out (the test harness)', () => {
    expect(isTrustedSender(undefined, UNCHECKED_SENDERS)).toBe(true)
    expect(isTrustedSender(null, UNCHECKED_SENDERS)).toBe(true)
    expect(isTrustedSender('https://evil.example/', UNCHECKED_SENDERS)).toBe(true)
  })
})
