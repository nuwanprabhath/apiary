import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { trackActivity } from '../../../src/renderer/state/activityStore'
import { reviewUi } from './review'

/** The status bar's activity indicator: a held pull, its outcomes, and several things at once. */
const WIDTHS = [620, 1400]
const indicator = (): HTMLElement | null => document.querySelector('[data-testid="activity-indicator"]')

async function startPull(settle: 'hold' | 'fail' | 'done'): Promise<void> {
  let release: (r: { commits: number }) => void = () => undefined
  await renderApp({}, (f) => {
    f.state.tracking.set('feature/wt', { upstream: true, ahead: 0, behind: 3, pending: 0 })
    f.override('gitUpdateBranch', () => {
      if (settle === 'fail') return Promise.reject(new Error('the remote hung up'))
      return new Promise((resolve) => { release = resolve })
    })
  })
  await until(() => document.querySelector('.project-row-wrap') !== null)
  const row = [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === 'repo-c-wt')
  if (row === undefined) throw new Error('no worktree row')
  const { x, y } = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x + 10, clientY: y + 5 }))
  await until(() => document.querySelector<HTMLButtonElement>('[data-testid="context-menu-pull"]')?.disabled === false)
  await userEvent.click(page.getByTestId('context-menu-pull'))
  await until(() => indicator() !== null)
  if (settle === 'done') release({ commits: 3 })
}

describe('activity indicator', () => {
  it('activity running', async () => {
    await startPull('hold')
    await reviewUi('activity running', { widths: WIDTHS })
  })

  it('activity done', async () => {
    await startPull('done')
    await until(() => indicator()?.getAttribute('data-state') === 'done')
    await reviewUi('activity done', { widths: WIDTHS })
  })

  it('activity failed', async () => {
    await startPull('fail')
    await until(() => indicator()?.getAttribute('data-state') === 'failed')
    await reviewUi('activity failed', { widths: WIDTHS })
  })

  it('activity several', async () => {
    await renderApp()
    for (const name of ['feature/wt', 'main', 'release/1.35.0']) {
      void trackActivity({ running: `Pulling ${name}…`, done: () => name, failed: name }, new Promise<never>(() => undefined))
    }
    await until(() => indicator() !== null)
    await reviewUi('activity several', {
      widths: WIDTHS,
      open: async () => {
        const el = indicator()
        if (el === null) return
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        el.dispatchEvent(new MouseEvent('mouseenter'))
        await until(() => document.querySelector('[data-testid="activity-hover"]') !== null)
      },
      close: async () => { indicator()?.dispatchEvent(new MouseEvent('mouseleave')) },
    })
  })
})
