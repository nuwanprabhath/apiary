import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { SECTIONS } from '../../src/renderer/features/settings/registry'
import { entryOwns, SEARCH_ENTRIES } from '../../src/renderer/features/settings/settingsIndex'
import { pluginEntries } from '../../src/renderer/features/settings/searchSettings'
import { SETTINGS, type SettingKey } from '@shared/settings/schema'

/** Settings whose entries come from what a plugin declares, not from `SEARCH_ENTRIES`. */
const FROM_PLUGINS: readonly SettingKey[] = ['plugins', 'pluginSettings']

/** Cards of things a person made (a pet, a resident, an account, a theme), not settings of their own. */
const USER_MADE = '[data-testid^="pet-card"], [data-testid^="resident-card"], [data-testid^="account-row"], [data-testid="theme-card"], [data-testid^="plugin-"]'

describe('every setting is searchable', () => {
  it('has an entry for every key of SETTINGS (a plugin key is declared by the plugin)', () => {
    const covered = new Set(SEARCH_ENTRIES.flatMap((e) => e.keys ?? []))
    const missing = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => !covered.has(k) && !FROM_PLUGINS.includes(k))
    expect(missing, 'add a SettingEntry (settingsIndex.ts) whose keys include these').toEqual([])
  })

  it('has an entry in a real section for each entry, with a unique id', () => {
    const ids = SEARCH_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    const sections = new Set(SECTIONS.map((s) => s.id))
    expect(SEARCH_ENTRIES.filter((e) => !sections.has(e.section)).map((e) => e.id)).toEqual([])
  })

  it('has an entry for every control a section draws, and each label is on its section', async () => {
    const { fake } = await renderApp()
    // Everything on, so the controls that appear only with another setting are drawn too.
    for (const [key, def] of Object.entries(SETTINGS)) {
      if (typeof def.default === 'boolean') (fake.state.settings as unknown as Record<string, unknown>)[key] = true
    }
    fake.state.settings.autoImportIntervalMinutes = 5
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    const unowned: string[] = []
    const absent: string[] = []
    for (const section of SECTIONS) {
      if (section.id === 'plugins') continue
      await userEvent.click(page.getByTestId(`settings-nav-${section.id}`))
      await until(() => document.querySelector('[data-testid="settings-pane"] .empty') === null)
      const pane = document.querySelector<HTMLElement>('[data-testid="settings-pane"]')
      if (pane === null) throw new Error('no pane')
      const entries = SEARCH_ENTRIES.filter((e) => e.section === section.id)
      for (const el of pane.querySelectorAll<HTMLElement>('input, select, textarea, button')) {
        const id = el.dataset.testid
        if (id === undefined || el.closest(USER_MADE) !== null) continue
        if (!entries.some((e) => entryOwns(e, id))) unowned.push(`${section.id}: ${id}`)
      }
      const text = pane.textContent
      for (const e of entries) {
        const first = e.testIds[0]
        if (first === undefined || first.endsWith('*') || pane.querySelector(`[data-testid="${first}"]`) === null) continue
        if (!text.includes(e.label)) absent.push(`${section.id}: ${e.label}`)
      }
    }
    expect(unowned, 'a control with no SettingEntry: add one to settingsIndex.ts').toEqual([])
    expect(absent, 'the label in settingsIndex.ts is not the one the section shows').toEqual([])
  })

  it('searches what a plugin declares', async () => {
    const { fake } = await renderApp()
    const entries = pluginEntries(fake.state.plugins)
    for (const p of fake.state.plugins) {
      expect(entries.some((e) => e.label === p.name)).toBe(true)
      for (const f of p.fields) expect(entries.some((e) => e.label === f.label && e.testIds.includes(`plugin-setting-${p.id}-${f.key}`))).toBe(true)
    }
  })
})
