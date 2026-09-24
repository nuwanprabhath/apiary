import { describe, it, expect } from 'vitest'
import { decideNavigation } from '../../src/main/navigationGuard'

/**
 * Reported: a link clicked in a transcript opened the web page *inside* Apiary, with no way back.
 * Every window must keep showing the app; links go to the system browser.
 */
describe('decideNavigation', () => {
  const packaged = 'file:///Applications/Apiary.app/Contents/Resources/app.asar/out/renderer/index.html?window=1'
  const dev = 'http://localhost:5173/?window=1'

  it('sends a web link to the system browser, from a packaged build and from the dev server', () => {
    expect(decideNavigation(packaged, 'https://gitlab.com/ternandsparrow/reri/-/work_items/3')).toBe('external')
    expect(decideNavigation(dev, 'https://example.com/')).toBe('external')
    expect(decideNavigation(packaged, 'http://example.com/')).toBe('external')
    expect(decideNavigation(packaged, 'mailto:someone@example.com')).toBe('external')
  })

  it('lets the app reload itself', () => {
    expect(decideNavigation(packaged, packaged)).toBe('allow')
    expect(decideNavigation(packaged, packaged.replace('window=1', 'window=2&detach=x'))).toBe('allow')
    expect(decideNavigation(dev, 'http://localhost:5173/?window=3')).toBe('allow')
  })

  it('never navigates the window to another local file, and never launches it either', () => {
    expect(decideNavigation(packaged, 'file:///etc/passwd')).toBe('block')
  })

  it('refuses schemes that are not safe to hand to the OS', () => {
    expect(decideNavigation(packaged, 'javascript:alert(1)')).toBe('block')
    expect(decideNavigation(packaged, 'vscode://file/etc/hosts')).toBe('block')
    expect(decideNavigation(packaged, 'not a url')).toBe('block')
  })

  it('treats another localhost port as external, not as the app', () => {
    expect(decideNavigation(dev, 'http://localhost:3000/')).toBe('external')
  })
})
