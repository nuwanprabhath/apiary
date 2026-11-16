import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { until } from './helpers'
import { highlightRuns, queryWords } from '../../src/renderer/features/settings/searchSettings'

async function openSettings(fake: FakeApiary): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-pane"] .empty') === null
    && document.querySelector('[data-testid="settings-dialog"]') !== null)
}

async function typeQuery(text: string): Promise<void> {
  await userEvent.fill(page.getByTestId('settings-search'), text)
}

const present = (id: string): boolean => document.querySelector(`[data-testid="${id}"]`) !== null
const navIds = (): string[] => [...document.querySelectorAll<HTMLElement>('.settings-nav-item')]
  .map((el) => el.dataset.testid?.replace('settings-nav-', '') ?? '')
const dialogOpen = (): boolean => present('settings-dialog')

describe('settings search: matching', () => {
  it('matches the label, the help text and the section name, in any order, ignoring case', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('PIPELINE')
    await until(() => present('settings-result-search-chat-content'))
    expect(present('settings-result-search-session-notes')).toBe(false)

    await typeQuery('notes search')
    await until(() => present('settings-result-search-session-notes'))
    expect(present('settings-result-search-chat-content')).toBe(false)

    await typeQuery('diagnostics')
    await until(() => present('settings-result-diagnostics-enabled'))
    expect(present('settings-result-log-limits')).toBe(true)
    expect(present('settings-result-log-folder')).toBe(true)
  })

  it('shows only the sections with matches, counted, and the matches under the section headings', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('interval')
    await until(() => present('settings-results'))
    expect(navIds()).toEqual(['sessions', 'themes', 'updates'].filter((id) => navIds().includes(id)))
    expect(navIds()).toContain('sessions')
    expect(navIds()).toContain('updates')
    expect(navIds()).not.toContain('diagnostics')
    expect(page.getByTestId('settings-nav-count-sessions').element().textContent).toBe('1')
    const headings = [...document.querySelectorAll('.settings-result-heading')].map((h) => h.textContent)
    expect(headings).toEqual(expect.arrayContaining(['Sessions', 'Updates']))
  })

  it('marks the words that matched', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('sessions imp')
    await until(() => present('settings-result-auto-import-all'))
    const marked = [...page.getByTestId('settings-result-auto-import-all').element().querySelectorAll('mark')]
      .map((m) => m.textContent.toLowerCase())
    expect(marked).toContain('sessions')
    expect(marked).toContain('imp')
  })

  it('says so when nothing matches', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('zzzxq')
    await until(() => present('settings-no-results'))
    expect(page.getByTestId('settings-no-results').element().textContent).toBe('No settings match “zzzxq”')
    expect(navIds()).toEqual([])
  })

  it('splits text into marked runs', () => {
    expect(queryWords('  Foo  bar ')).toEqual(['foo', 'bar'])
    expect(highlightRuns('Search a.b', ['a.b', 'sea'])).toEqual([
      { at: 0, text: 'Sea', hit: true }, { at: 3, text: 'rch ', hit: false }, { at: 7, text: 'a.b', hit: true },
    ])
  })
})

describe('settings search: opening a result', () => {
  it('opens the section scrolled to the setting, marks it, and ends the search', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('proofing')
    await userEvent.click(page.getByTestId('settings-result-proofing-language'))
    await until(() => present('proofing-language-select'))
    expect(present('settings-results')).toBe(false)
    expect((page.getByTestId('settings-search').element() as HTMLInputElement).value).toBe('')
    expect(page.getByTestId('settings-nav-general').element().dataset.active).toBe('true')
    await until(() => document.querySelector('[data-found="true"]') !== null)
    const row = document.querySelector('[data-found="true"]')
    expect(row?.contains(page.getByTestId('proofing-language-select').element())).toBe(true)
    const pane = page.getByTestId('settings-pane').element().getBoundingClientRect()
    const at = row?.getBoundingClientRect()
    expect(at !== undefined && at.top >= pane.top - 1 && at.bottom <= pane.bottom + 1).toBe(true)
  })

  it('opens the first result on Enter', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('prerelease')
    await until(() => present('settings-result-update-prerelease'))
    await userEvent.keyboard('{Enter}')
    await until(() => present('setting-update-prerelease'))
    expect(page.getByTestId('settings-nav-updates').element().dataset.active).toBe('true')
  })

  it('reaches a setting whose field is hidden by finding the switch that shows it', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('minutes')
    await userEvent.click(page.getByTestId('settings-result-auto-import-interval'))
    await until(() => document.querySelector('[data-found="true"]') !== null)
    expect(document.querySelector('[data-found="true"]')?.contains(page.getByTestId('setting-auto-import-interval-enabled').element())).toBe(true)
  })

  it('clicking a section in the narrowed list opens its first match', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('interval')
    await userEvent.click(page.getByTestId('settings-nav-updates'))
    await until(() => present('setting-update-automatic'))
    expect(page.getByTestId('settings-nav-updates').element().dataset.active).toBe('true')
  })
})

describe('settings search: keyboard', () => {
  it('Cmd/Ctrl+F focuses the field, selecting what is in it', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    expect(document.activeElement).not.toBe(page.getByTestId('settings-search').element())
    await userEvent.keyboard('{Meta>}f{/Meta}')
    expect(document.activeElement).toBe(page.getByTestId('settings-search').element())
  })

  it('Escape clears the query, a second Escape closes the dialog', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await typeQuery('proofing')
    await until(() => present('settings-results'))
    await userEvent.keyboard('{Escape}')
    await until(() => !present('settings-results'))
    expect(dialogOpen()).toBe(true)
    await userEvent.keyboard('{Escape}')
    await until(() => !dialogOpen())
  })

  it('clearing the query puts back the section that was open', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    await userEvent.click(page.getByTestId('settings-nav-terminal'))
    await typeQuery('proofing')
    await until(() => present('settings-results'))
    await userEvent.click(page.getByTestId('settings-search-clear'))
    await until(() => !present('settings-results'))
    expect(page.getByTestId('settings-nav-terminal').element().dataset.active).toBe('true')
    expect(present('setting-terminal-minimal-prompt')).toBe(true)
  })

  it('the field is above the first section and says what it is for', async () => {
    const { fake } = await renderApp()
    await openSettings(fake)
    const field = page.getByTestId('settings-search').element()
    expect(field.getAttribute('placeholder')).toBe('Search settings')
    const first = page.getByTestId('settings-nav-sessions').element()
    expect(field.getBoundingClientRect().bottom).toBeLessThanOrEqual(first.getBoundingClientRect().top)
  })
})
