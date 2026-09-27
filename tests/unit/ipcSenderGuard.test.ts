import { describe, it, expect } from 'vitest'
import { isTrustedRendererUrl, isTrustedSender } from '../../src/main/ipc/ipcSenderGuard'

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
  it('allows when there is nothing to check — no configured expectation, or no sender frame url', () => {
    expect(isTrustedSender(undefined, null)).toBe(true)
    expect(isTrustedSender(undefined, { devServerOrigin: null })).toBe(true)
    expect(isTrustedSender('file:///Applications/Apiary.app/.../renderer/index.html', null)).toBe(true)
  })

  it('defers to isTrustedRendererUrl once both a url and an expectation are present', () => {
    const expected = { devServerOrigin: null }
    expect(isTrustedSender('file:///a/renderer/index.html', expected)).toBe(true)
    expect(isTrustedSender('https://evil.example/', expected)).toBe(false)
  })
})
