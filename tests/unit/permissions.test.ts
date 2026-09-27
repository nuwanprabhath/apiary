import { describe, it, expect } from 'vitest'
import { allowPermission, isAppUrl } from '../../src/main/app/permissions'

const packaged = 'file:///Applications/Apiary.app/Contents/Resources/app.asar/out/renderer/index.html?window=1'
const dev = 'http://localhost:5173/?window=1'

describe('isAppUrl', () => {
  it('treats another file in a packaged build as not the app', () => {
    expect(isAppUrl('file:///etc/passwd', packaged)).toBe(false)
  })

  it('treats the same packaged page, whatever its query, as the app', () => {
    expect(isAppUrl(packaged.replace('window=1', 'window=2'), packaged)).toBe(true)
  })

  it('treats the dev server origin as the app', () => {
    expect(isAppUrl('http://localhost:5173/?window=3', dev)).toBe(true)
  })

  it('treats another localhost port as not the app', () => {
    expect(isAppUrl('http://localhost:3000/', dev)).toBe(false)
  })

  it('rejects an unparseable URL rather than throwing', () => {
    expect(isAppUrl('not a url', packaged)).toBe(false)
  })
})

describe('allowPermission', () => {
  // SEC-10: Electron grants every permission by default with no handler installed. The renderer
  // only ever needs the clipboard (TerminalView's paste path).
  it('allows the clipboard permissions from the app itself', () => {
    expect(allowPermission('clipboard-read', packaged, packaged)).toBe(true)
    expect(allowPermission('clipboard-sanitized-write', packaged, packaged)).toBe(true)
  })

  it('refuses camera, microphone, geolocation and every other permission, even from the app', () => {
    for (const permission of ['media', 'geolocation', 'notifications', 'midi', 'display-capture', 'hid', 'serial', 'usb', 'openExternal']) {
      expect(allowPermission(permission, packaged, packaged)).toBe(false)
    }
  })

  it('refuses the clipboard for content that is not the app', () => {
    expect(allowPermission('clipboard-read', 'https://evil.example/', packaged)).toBe(false)
  })
})
