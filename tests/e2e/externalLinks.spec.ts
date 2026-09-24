import { test, expect } from '@playwright/test'
import { launchApiary, type Harness } from './helpers'

/**
 * Reported: clicking a link in a transcript opened the page inside Apiary, with no way back.
 * Links go to the system browser; the window keeps showing the app.
 */
let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  // Record what the app asks the OS to open, instead of actually launching a browser.
  await h.app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = async (url: string) => { g.opened.push(url) }
  })
})
test.afterEach(async () => { await h.close() })

const opened = (): Promise<string[]> =>
  h.app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)

for (const target of ['_self', '_blank']) {
  test(`a clicked web link (target=${target}) opens in the browser and the window stays on Apiary`, async () => {
    const before = h.page.url()
    await h.page.evaluate((t) => {
      const a = document.createElement('a')
      a.href = 'https://gitlab.com/ternandsparrow/reri/-/work_items/3'
      a.target = t
      a.textContent = 'the ticket'
      a.id = 'test-link'
      document.body.appendChild(a)
    }, target)
    // `noWaitAfter`: Playwright otherwise waits on the navigation the guard cancels, and never returns.
    await h.page.locator('#test-link').click({ noWaitAfter: true })

    await expect.poll(opened).toEqual(['https://gitlab.com/ternandsparrow/reri/-/work_items/3'])
    expect(h.app.windows()).toHaveLength(1)
    // Asked of the window itself, from the main process, rather than through Playwright's page:
    // Playwright sees a navigation start and is never told the guard cancelled it, so its own
    // locators wait forever on "navigation to finish" even though the page never left.
    const still = await h.app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      return {
        url: wc.getURL(),
        sidebar: await wc.executeJavaScript('document.querySelector(\'[data-testid="sidebar"]\') !== null') as boolean,
      }
    })
    expect(still).toEqual({ url: before, sidebar: true })
  })
}
