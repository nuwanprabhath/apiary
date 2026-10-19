import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { sidebarSession, until } from './helpers'

const DAY = 86_400_000
const OLD = 'Fix CSV export bug'

async function openSidebarSettings(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-sidebar'))
}

async function saveSettings(): Promise<void> {
  await userEvent.click(page.getByTestId('settings-save'))
  await until(() => document.querySelector('[data-testid="settings-dialog"]') === null)
}

describe('sessions the tree leaves out', () => {
  it('is off by default, and the days field appears only when it is checked', async () => {
    const { fake } = await renderApp()
    await openSidebarSettings(fake)
    await expect.element(page.getByTestId('setting-hide-old-enabled')).not.toBeChecked()
    expect(page.getByTestId('setting-hide-old-days').elements()).toHaveLength(0)

    await userEvent.click(page.getByTestId('setting-hide-old-enabled'))
    await userEvent.fill(page.getByTestId('setting-hide-old-days'), '45')
    page.getByTestId('setting-hide-old-days').element().dispatchEvent(new Event('blur'))
    await saveSettings()
    expect(fake.callsTo('settingsSet').at(-1)?.[0]).toMatchObject({ hideOldSessionsEnabled: true, hideOldSessionsDays: 45 })
  })

  it('drops an old session from the tree, still finds it by search, and shows it again when off', async () => {
    const { fake } = await renderApp()
    await until(() => page.getByTestId('session-item').elements().length === 4)
    const old = fake.state.sessions.find((s) => s.title === OLD)
    if (old === undefined) throw new Error('fixture session missing')
    old.lastActiveAtMs = Date.now() - 100 * DAY
    for (const s of fake.state.sessions) if (s !== old) s.lastActiveAtMs = Date.now() - DAY
    fake.emit('treeChanged')

    await openSidebarSettings(fake)
    await userEvent.click(page.getByTestId('setting-hide-old-enabled'))
    await saveSettings()
    await until(() => page.getByTestId('session-item').elements().length === 3)
    await expect.element(sidebarSession(OLD)).not.toBeInTheDocument()

    await userEvent.fill(page.getByTestId('search-input'), 'csv')
    await until(() => page.getByTestId('session-item').elements().length === 1)
    await expect.element(sidebarSession(OLD)).toBeVisible()
    await userEvent.fill(page.getByTestId('search-input'), '')

    await openSidebarSettings(fake)
    await userEvent.click(page.getByTestId('setting-hide-old-enabled'))
    await saveSettings()
    await until(() => page.getByTestId('session-item').elements().length === 4)
  })

  it('always leaves out a session whose folder is gone, but search finds it and an open tab keeps it', async () => {
    const { fake } = await renderApp()
    await until(() => page.getByTestId('session-item').elements().length === 4)
    const gone = fake.state.sessions.find((s) => s.title === OLD)
    if (gone === undefined) throw new Error('fixture session missing')
    gone.cwdExists = false
    fake.emit('treeChanged')
    await until(() => page.getByTestId('session-item').elements().length === 3)
    expect(document.querySelector('.missing')).toBeNull()

    await userEvent.fill(page.getByTestId('search-input'), 'csv')
    await until(() => page.getByTestId('session-item').elements().length === 1)
    await expect.element(page.getByTestId('session-item').getByText('folder gone')).toBeVisible()
    await userEvent.click(sidebarSession(OLD))
    await userEvent.fill(page.getByTestId('search-input'), '')
    await until(() => page.getByTestId('session-item').elements().length === 4)
  })
})
