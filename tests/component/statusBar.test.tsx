import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import type { StatusBarItem } from '../../src/shared/domain/statusBar'

const USAGE: StatusBarItem = {
  pluginId: 'claude-usage', id: 'usage', icon: 'gauge', text: '5h 91% (2:20 pm) · 7d 2%', title: 'Claude usage',
  tone: 'warning', action: { kind: 'panel' },
  detail: [{ kind: 'heading', text: 'Claude Usage' }, { kind: 'table', columns: ['', 'Today'], rows: [['Tokens', '1.2M']], numericFrom: 1 }],
}
const REFRESH: StatusBarItem = {
  pluginId: 'claude-usage', id: 'refresh', icon: 'refresh', text: '', title: 'Refresh Claude usage now',
  tone: 'normal', action: { kind: 'refresh' }, detail: [],
}

describe('the status bar', () => {
  it('is not drawn at all when no plugin contributes anything', async () => {
    await renderApp()
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    expect(document.querySelector('[data-testid="status-bar"]')).toBeNull()
  })

  it('shows each item with its tone, its detail on hover, and follows a change pushed from main', async () => {
    const { fake } = await renderApp({ statusBar: [USAGE, REFRESH] })
    const usage = page.getByTestId('status-item-claude-usage-usage')
    await expect.element(usage).toHaveTextContent('5h 91% (2:20 pm) · 7d 2%')
    await expect.element(usage).toHaveAttribute('data-tone', 'warning')

    await userEvent.hover(usage)
    await expect.element(page.getByTestId('status-hover')).toBeVisible()
    await expect.poll(() => document.querySelector('[data-testid="status-hover"]')?.textContent ?? '').toMatch(/Tokens\s*1\.2M/)

    fake.state.statusBar = [{ ...USAGE, text: '5h 12% · 7d 3%', tone: 'normal' }, REFRESH]
    fake.emit('statusBarChanged')
    await expect.element(usage).toHaveTextContent('5h 12% · 7d 3%')
  })

  it('the refresh item asks its plugin to refresh; the usage item opens its dashboard', async () => {
    const { fake } = await renderApp({
      statusBar: [USAGE, REFRESH],
      statusBarPanel: { title: 'Claude Usage', refreshable: true, sections: [{ kind: 'gauges', gauges: [{ label: '5-hour', percent: 91, tone: 'warning', caption: 'resets Wed 2:20 pm' }] }] },
    })
    await userEvent.click(page.getByTestId('status-item-claude-usage-refresh'))
    await expect.poll(() => fake.callsTo('statusBarRefresh')).toEqual([['claude-usage']])

    await userEvent.click(page.getByTestId('status-item-claude-usage-usage'))
    await expect.element(page.getByTestId('status-panel')).toBeVisible()
    await expect.element(page.getByRole('meter', { name: '5-hour' })).toHaveAttribute('aria-valuenow', '91')

    await userEvent.click(page.getByTestId('status-panel-settings'))
    await expect.element(page.getByTestId('status-panel')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('settings-dialog')).toBeVisible()
  })
})
