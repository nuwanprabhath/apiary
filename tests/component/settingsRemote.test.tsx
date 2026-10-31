import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { machinePayload } from '@shared/settings/schema'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { until } from './helpers'

/**
 * Settings in a remote window (one showing a work machine): it opens on the work machine's settings,
 * with a switch to this machine's; the work machine's view leaves out how this screen looks, and
 * cannot switch off the remote access the window runs over.
 */
async function renderRemote(host: string, arrange?: (fake: FakeApiary) => void): ReturnType<typeof renderApp> {
  history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=${host}`)
  return renderApp({}, (fake) => {
    // The work machine's settings differ from this machine's, so the test can tell which it shows.
    fake.override('machineSettingsGet', async () => machinePayload({ ...fake.state.settings, recentSectionHours: 5, remoteAccess: true }))
    arrange?.(fake)
  })
}

async function openSettings(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
}

const navIds = (): string[] =>
  [...document.querySelectorAll('[data-testid^="settings-nav-"]')].map((b) => b.getAttribute('data-testid') ?? '')

afterEach(() => { history.replaceState(null, '', location.pathname) })

describe('settings in a remote window', () => {
  it('opens on the work machine, titled with its name, and the switch shows this machine\'s sections', async () => {
    const { fake } = await renderRemote('work-box')
    await openSettings(fake)
    await expect.element(page.getByRole('heading', { name: 'Settings — work-box' })).toBeVisible()
    await expect.element(page.getByTestId('settings-machine-remote')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(page.getByTestId('settings-nav-sidebar'))
    await expect.element(page.getByTestId('settings-pane').getByRole('spinbutton').first()).toHaveValue(5)

    await userEvent.click(page.getByTestId('settings-machine-this'))
    await expect.element(page.getByRole('heading', { name: /^Settings — This (Mac|computer)$/ })).toBeVisible()
    await until(() => navIds().includes('settings-nav-themes'))
    expect(navIds()).toContain('settings-nav-pets')
    // A remote window's residents are the work machine's; this machine's are managed in its own windows.
    expect(navIds()).not.toContain('settings-nav-residents')
  })

  it('the screen sections are not in the work machine\'s view, and a line says where they are', async () => {
    const { fake } = await renderRemote('work-box')
    await openSettings(fake)
    await expect.element(page.getByTestId('settings-screen-note')).toMatchTextContent(/Themes, pets and animations are this (Mac|computer)'s own/)
    expect(navIds()).not.toContain('settings-nav-themes')
    expect(navIds()).not.toContain('settings-nav-pets')
    await userEvent.click(page.getByTestId('settings-nav-general'))
    await expect.element(page.getByTestId('claude-bin-input')).toBeVisible()
    expect(document.querySelector('[data-testid="proofing-language-select"]')).toBeNull()
    expect(document.querySelector('[data-testid="setting-system-title-bar"]')).toBeNull()

    await userEvent.click(page.getByTestId('settings-switch-to-this'))
    await until(() => navIds().includes('settings-nav-themes'))
    expect(document.querySelector('[data-testid="settings-screen-note"]')).toBeNull()
  })

  it('a save in the work machine\'s view goes to machineSettingsSet with machine keys only, not settingsSet', async () => {
    const { fake } = await renderRemote('work-box')
    await openSettings(fake)
    await expect.element(page.getByTestId('settings-pane')).toMatchTextContent('Automatically import all sessions')
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => fake.callsTo('machineSettingsSet').length === 1)
    expect(fake.callsTo('settingsSet')).toEqual([])
    const [patch] = fake.callsTo('machineSettingsSet')[0] as [Record<string, unknown>]
    expect(patch.recentSectionHours).toBe(5)
    expect(patch).not.toHaveProperty('motion')
    expect(patch).not.toHaveProperty('proofingLanguage')
    expect(patch).not.toHaveProperty('remoteAccess')
  })

  it('a save in this machine\'s view goes to settingsSet', async () => {
    const { fake } = await renderRemote('work-box')
    await openSettings(fake)
    await userEvent.click(page.getByTestId('settings-machine-this'))
    await expect.element(page.getByTestId('settings-pane')).toMatchTextContent('Automatically import all sessions')
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => fake.callsTo('settingsSet').length === 1)
    expect(fake.callsTo('machineSettingsSet')).toEqual([])
  })

  it('remote access shows its state on the work machine\'s view but cannot be turned off there', async () => {
    const { fake } = await renderRemote('work-box')
    await openSettings(fake)
    await userEvent.click(page.getByTestId('settings-nav-general'))
    await expect.element(page.getByTestId('remote-access-readonly')).toMatchTextContent('cannot be turned off from here')
    expect(page.getByTestId('remote-access-readonly').getByRole('checkbox').elements()).toHaveLength(0)
    expect(page.getByTestId('remote-access-readonly').getByRole('switch').elements()).toHaveLength(0)
  })

  it('a local window has no switch and its title is plain', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await expect.element(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    expect(document.querySelector('[data-testid="settings-machine-switch"]')).toBeNull()
  })
})
