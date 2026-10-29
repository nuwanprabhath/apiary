import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { mouse, sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** A tab strip with more tabs than fit: its arrows, and the fade at the edges that hide tabs. */
const TITLES = ['Fix CSV export bug', 'Add worktree switcher', 'Repo root session', 'Worktree session']
const strip = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="session-tab-strip"]')!

async function open(): Promise<void> {
  await renderApp()
  for (const title of TITLES) await userEvent.click(sidebarSession(title))
  await mouse.move(1, 1)
  await until(() => document.querySelector('.hover-card') === null)
}

const bar = (): Element | null => document.querySelector('[data-testid="session-tab-bar"]')

describe('UI tab strip overflow', () => {
  it('scrolled to the middle: both arrows, both edges fading', async () => {
    await open()
    await reviewUi('tab strip overflow middle', {
      widths: [760],
      within: bar,
      open: async () => {
        await until(() => document.querySelector('[data-testid="session-tab-scroll-right"]') !== null)
        strip().scrollLeft = (strip().scrollWidth - strip().clientWidth) / 2
        await until(() => strip().dataset.moreLeft === 'true' && strip().dataset.moreRight === 'true')
      },
    })
  })
})
