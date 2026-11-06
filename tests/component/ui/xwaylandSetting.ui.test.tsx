import { describe, it, expect, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi } from './review'

/** Settings → General on Linux: "Bring windows back on their own monitors (XWayland)". */
const REAL = navigator.userAgent
/** Stands in for the browser of another system: the tests run on a Mac here and on Linux in CI. */
const as = (userAgent: string): void => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => userAgent })
}
const asLinux = (): void => { as('Mozilla/5.0 (X11; Linux x86_64) Apiary') }
const asMac = (): void => { as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Apiary') }
afterEach(() => { as(REAL) })

async function openGeneral(): Promise<ReturnType<typeof renderApp>> {
  const rendered = renderApp({ settings: { linuxXWayland: true } })
  const { fake } = await rendered
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-general'))
  return rendered
}

describe('UI: the XWayland setting', () => {
  it('xwayland setting on linux', async () => {
    asLinux()
    const { fake } = await openGeneral()
    await until(() => document.querySelector('[data-testid="setting-linux-xwayland"]') !== null)
    await reviewUi('xwayland setting on linux', {
      widths: [620, 900],
      open: async () => { document.querySelector('[data-testid="setting-linux-xwayland"]')?.scrollIntoView({ block: 'center' }); await Promise.resolve() },
    })
    // Off, then Save: Apiary runs as a Wayland app from its next start.
    await userEvent.click(page.getByTestId('setting-linux-xwayland'))
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => fake.callsTo('settingsSet').length > 0)
    expect(fake.callsTo('settingsSet').at(-1)?.[0]).toMatchObject({ linuxXWayland: false })
  })

  it('is not offered on a Mac', async () => {
    asMac()
    await openGeneral()
    await until(() => document.querySelector('[data-testid="setting-system-title-bar"]') !== null)
    expect(document.querySelector('[data-testid="setting-linux-xwayland"]')).toBeNull()
  })
})
