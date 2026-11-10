import { describe, it, expect } from 'vitest'
import { isTrustedRendererUrl, rendererEntryFile, isTrustedSender, UNCHECKED_SENDERS } from '../../src/main/ipc/ipcSenderGuard'

describe('isTrustedRendererUrl', () => {
  it('accepts a packaged renderer URL regardless of its window-number query', () => {
    const expected = { devServerOrigin: null, rendererFile: null }
    expect(isTrustedRendererUrl('file:///Applications/Apiary.app/Contents/Resources/app/out/renderer/index.html?w=1', expected)).toBe(true)
    expect(isTrustedRendererUrl('file:///Applications/Apiary.app/Contents/Resources/app/out/renderer/index.html?w=2&detach=k', expected)).toBe(true)
  })

  it('refuses a file:// URL that is not the renderer entry point', () => {
    const expected = { devServerOrigin: null, rendererFile: null }
    expect(isTrustedRendererUrl('file:///etc/passwd', expected)).toBe(false)
    expect(isTrustedRendererUrl('file:///Applications/Apiary.app/Contents/Resources/app/out/renderer/other.html', expected)).toBe(false)
  })

  it('compares a file: URL with the exact renderer file when one is configured', () => {
    const expected = { devServerOrigin: null, rendererFile: '/app/out/renderer/index.html' }
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html?w=1', expected)).toBe(true)
    expect(isTrustedRendererUrl('file:///tmp/x/renderer/index.html', expected)).toBe(false)
  })

  it('refuses an http(s) URL when not configured for a dev server', () => {
    expect(isTrustedRendererUrl('https://example.com/', { devServerOrigin: null, rendererFile: null })).toBe(false)
  })

  it('accepts only the configured dev-server origin, any path or query', () => {
    const expected = { devServerOrigin: 'http://localhost:5173', rendererFile: null }
    expect(isTrustedRendererUrl('http://localhost:5173/?w=1', expected)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/index.html?w=2', expected)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:9999/?w=1', expected)).toBe(false)
    expect(isTrustedRendererUrl('http://evil.example/?w=1', expected)).toBe(false)
  })

  it('refuses an unparseable URL', () => {
    expect(isTrustedRendererUrl('not a url', { devServerOrigin: null, rendererFile: null })).toBe(false)
  })
})

describe('rendererEntryFile', () => {
  it('is the file the window manager loads, beside the main bundle', () => {
    expect(rendererEntryFile('/app/out/main')).toBe('/app/out/renderer/index.html')
  })
})

describe('isTrustedSender', () => {
  const expected = { devServerOrigin: null, rendererFile: null }

  it('denies a missing sender frame: Electron sets senderFrame to null for a destroyed frame', () => {
    expect(isTrustedSender(undefined, expected)).toBe(false)
    expect(isTrustedSender(null, expected)).toBe(false)
    expect(isTrustedSender(undefined, { devServerOrigin: 'http://localhost:5173', rendererFile: null })).toBe(false)
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
