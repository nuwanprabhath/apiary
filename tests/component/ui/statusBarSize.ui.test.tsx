import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { renderApp } from '../renderApp'
import { mouse, until } from '../helpers'
import { mrDeskStatus, regentStatus, withMrDesk, withRegent } from '../residentFixtures'
import { trackActivity } from '../../../src/renderer/state/activityStore'
import { writeResidentPopupRect } from '../../../src/renderer/state/uiState'
import { reviewUi } from './review'

const USAGE: StatusBarItem = {
  pluginId: 'claude-usage', id: 'usage', icon: 'gauge', text: 'Personnel · 5h 29% (12:50 pm) · 7d 65%', title: 'Claude usage',
  tone: 'normal', action: { kind: 'panel' },
  detail: [{ kind: 'heading', text: 'Claude usage' }, { kind: 'note', text: 'Personnel · 5h 29% (12:50 pm) · 7d 65%' }],
}
const REFRESH: StatusBarItem = {
  pluginId: 'claude-usage', id: 'refresh', icon: 'refresh', text: '', title: 'Refresh Claude usage now',
  tone: 'normal', action: { kind: 'refresh' }, detail: [],
}

const bar = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="status-bar"]')!
const handle = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="status-bar-resize"]')
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="status-bar-menu"]')

/** A bar of `px` with everything in it: an indexing activity, a working bee with a long activity, the honey pot needing you, and the usage item. */
async function fullBar(px: number): Promise<void> {
  localStorage.setItem('apiary.statusBarHeight', String(px))
  const { fake } = await renderApp({ statusBar: [USAGE, REFRESH] }, (f) => { withRegent(f); withMrDesk(f) })
  await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
  void trackActivity({ running: 'Indexing 3 folders', done: () => 'Indexed', failed: 'Indexing failed' }, new Promise<void>(() => undefined))
  fake.emit('residentsChanged', [
    regentStatus('working', 'Running mra prompt 1559 against the release branch'),
    mrDeskStatus('idle', { attention: { count: 2, summary: '2 MRs ready to approve' } }),
  ])
  await until(() => document.querySelector('[data-testid="activity-indicator"]') !== null)
}

const openMenu = async (): Promise<void> => {
  const floor = document.querySelector<HTMLElement>('[data-testid="status-bar-floor"]')!
  const r = floor.getBoundingClientRect()
  floor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 4, clientY: r.y + r.height / 2 }))
  await until(() => menu() !== null)
}

describe('UI: the status bar at each size', () => {
  it.each([
    { name: 'compact', px: 22 },
    { name: 'comfortable', px: 34 },
    { name: 'tall', px: 52 },
    { name: 'tallest', px: 64 },
  ])('$name, with everything in it', async ({ name, px }) => {
    await fullBar(px)
    await reviewUi(`status bar ${name}`, { within: bar })
  })

  it('the menu open', async () => {
    await fullBar(34)
    await reviewUi('status bar size menu', {
      open: openMenu,
      close: async () => { await userEvent.keyboard('{Escape}'); await until(() => menu() === null) },
    })
  })

  it('resize mode mid-drag, with the height tag', async () => {
    await fullBar(22)
    await reviewUi('status bar resize mid-drag', {
      open: async () => {
        if (handle() === null) {
          await openMenu()
          await userEvent.click(document.querySelector<HTMLElement>('[data-testid="context-menu-resize"]')!)
          await until(() => handle() !== null)
        }
        const r = handle()!.getBoundingClientRect()
        await mouse.move(r.x + r.width / 2, r.y + 1)
        await mouse.down()
        await mouse.move(r.x + r.width / 2, r.y - 12, 3)
        await until(() => document.querySelector('[data-testid="status-bar-resize-tag"]') !== null)
      },
      close: async () => { await mouse.up() },
    })
  })

  it('the resident popup open over a tall bar sits above it, whatever rect was saved', async () => {
    writeResidentPopupRect({ right: 12, bottom: 4, width: 380, height: 420 })
    await fullBar(52)
    const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
    await reviewUi('status bar tall with the popup open', {
      open: async () => {
        if (popup() === null) await userEvent.click(document.querySelector<HTMLElement>('[data-testid="resident-badge-regent"]')!)
        await until(() => popup() !== null && popup()!.getBoundingClientRect().bottom <= bar().getBoundingClientRect().top)
      },
    })
  })
})
