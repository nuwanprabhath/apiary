import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { activitiesNow, trackActivity } from '../../src/renderer/state/activityStore'

const spec = { running: 'Doing X…', done: (n: number) => `Did X ${String(n)}`, failed: 'X failed' }
const state = (): string => activitiesNow().map((a) => `${a.state}:${a.message}`).join('|')

describe('the activity store', () => {
  afterEach(() => { vi.useRealTimers() })

  it('shows work running, then its outcome, and returns the work unchanged', async () => {
    await renderApp()
    let finish: (n: number) => void = () => undefined
    const work = new Promise<number>((resolve) => { finish = resolve })
    const tracked = trackActivity(spec, work)
    expect(tracked).toBe(work)
    expect(state()).toBe('running:Doing X…')
    finish(3)
    await expect(tracked).resolves.toBe(3)
    await expect.poll(state).toBe('done:Did X 3')
  })

  it('drops a done activity after 4 s and a failed one after 10 s', async () => {
    await renderApp()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    await trackActivity(spec, Promise.resolve(1))
    const failing = trackActivity({ ...spec, running: 'Y…' }, Promise.reject(new Error('boom')))
    await expect(failing).rejects.toThrow('boom')
    expect(activitiesNow()).toHaveLength(2)
    vi.advanceTimersByTime(3900)
    expect(activitiesNow()).toHaveLength(2)
    vi.advanceTimersByTime(200)
    expect(state()).toBe('failed:X failed')
    vi.advanceTimersByTime(5800)
    expect(activitiesNow()).toHaveLength(1)
    vi.advanceTimersByTime(300)
    expect(activitiesNow()).toHaveLength(0)
  })
})

function folderRow(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
}

async function openPullMenu(): Promise<void> {
  await until(() => folderRow('repo-c-wt') !== undefined)
  const row = folderRow('repo-c-wt')
  if (row === undefined) throw new Error('no worktree row')
  const { x, y } = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x + 10, clientY: y + 5 }))
  await until(() => document.querySelector('[data-testid="context-menu-pull"]') !== null)
}

const pullItem = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-testid="context-menu-pull"]')
const indicator = (): string => document.querySelector('[data-testid="activity-indicator"]')?.textContent ?? ''

describe('pulling from the worktree menu', () => {
  it('shows Pulling in the status bar while it runs, disables Pull, then says Pulled', async () => {
    let finish: (r: { commits: number }) => void = () => undefined
    await renderApp({}, (f) => {
      f.state.tracking.set('feature/wt', { upstream: true, ahead: 0, behind: 2, pending: 0 })
      f.override('gitUpdateBranch', () => new Promise((resolve) => { finish = resolve }))
    })
    await openPullMenu()
    await expect.poll(() => pullItem()?.disabled).toBe(false)
    await userEvent.click(page.getByTestId('context-menu-pull'))
    await expect.poll(indicator).toBe('Pulling feature/wt…')
    await openPullMenu()
    await expect.poll(() => pullItem()?.title).toBe('Pulling…')
    expect(pullItem()?.disabled).toBe(true)
    finish({ commits: 2 })
    await expect.poll(indicator).toBe('Pulled feature/wt (2 commits)')
  })

  it('says Pull failed and still notifies', async () => {
    await renderApp({}, (f) => {
      f.state.tracking.set('feature/wt', { upstream: true, ahead: 0, behind: 1, pending: 0 })
      f.override('gitUpdateBranch', () => Promise.reject(new Error('the remote hung up')))
    })
    await openPullMenu()
    await expect.poll(() => pullItem()?.disabled).toBe(false)
    await userEvent.click(page.getByTestId('context-menu-pull'))
    await expect.poll(indicator).toBe('Pull failed: feature/wt')
    await expect.poll(() => document.querySelector('[data-testid="notification-message"]')?.textContent ?? '')
      .toBe('Pull failed: the remote hung up')
  })
})
