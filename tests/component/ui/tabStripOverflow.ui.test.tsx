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

  it('long titles: each tab stops at its cap and the title ellipsizes', async () => {
    const { fake } = await renderApp()
    const long = ['Staging failed to update error', '#2523 generic Org feedback round two', 'Investigate the nightly pets 3D flake']
    long.forEach((t, i) => { const s = fake.state.sessions[i]; if (s !== undefined) s.title = t })
    fake.emit('treeChanged')
    for (const t of long) {
      await until(() => document.body.textContent.includes(t))
      await userEvent.click(sidebarSession(t))
    }
    await mouse.move(1, 1)
    await until(() => document.querySelector('.hover-card') === null)
    await reviewUi('tab strip long titles', { widths: [760, 1400], within: bar })
  })
})
