import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { reviewUi } from './review'

/** The status bar's window buttons: four windows, one working, one waiting, one minimised, long titles. */
function fourWindows(fake: FakeApiary): void {
  fake.state.appWindows = [
    { number: 1, title: 'Fix CSV export bug', focused: true, minimized: false, remoteHost: null },
    { number: 2, title: '2317-fauna-species-list-ids: merge dev before the 7:30 booking', focused: false, minimized: false, remoteHost: null },
    { number: 3, title: 'Review MR !1436 — the species picker', focused: false, minimized: false, remoteHost: null },
    { number: 4, title: 'Repo root session', focused: false, minimized: true, remoteHost: null },
  ]
  fake.state.tabs = [
    { windowNumber: 2, key: 'w2-tab', view: 'terminal', status: 'running', label: 'Working one' },
    { windowNumber: 3, key: 'w3-tab', view: 'terminal', status: 'waiting', label: 'Waiting one' },
  ]
}

/** A window as a thumbnail shows one: a sidebar, a conversation and a message box, in the dark theme's colours. */
function windowPicture(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 720
  canvas.height = 450
  const g = canvas.getContext('2d')!
  const box = (colour: string, x: number, y: number, w: number, h: number): void => { g.fillStyle = colour; g.fillRect(x, y, w, h) }
  box('#1b1c1e', 0, 0, 720, 450)
  box('#232528', 8, 8, 170, 434)
  for (let i = 0; i < 9; i++) box('#3a3d42', 20, 30 + i * 22, 110 + (i % 3) * 20, 8)
  box('#232528', 186, 8, 526, 434)
  for (let i = 0; i < 7; i++) box(i % 3 === 0 ? '#2f3238' : '#3a3d42', 204, 40 + i * 40, 380 - (i % 4) * 50, i % 3 === 0 ? 24 : 10)
  box('#d9a441', 204, 380, 3, 40)
  box('#2a2c30', 210, 380, 480, 40)
  return canvas.toDataURL('image/png')
}

const button = (n: number): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="window-button"][data-window="${String(n)}"]`)!

describe('UI: the window buttons', () => {
  it('window buttons', async () => {
    await renderApp({}, fourWindows)
    await until(() => document.querySelectorAll('[data-testid="window-button"]').length === 4)
    await until(() => button(2).dataset.glow === 'running')
    await reviewUi('window buttons', { widths: [620, 900, 1400] })
  })

  it('window preview', async () => {
    await renderApp({}, (fake) => { fourWindows(fake); fake.state.appWindowPictures.set(2, windowPicture()) })
    await until(() => document.querySelectorAll('[data-testid="window-button"]').length === 4)
    await reviewUi('window preview', {
      widths: [900, 1400],
      open: async () => {
        await userEvent.hover(button(2))
        await until(() => document.querySelector('[data-testid="window-preview"] img') !== null)
      },
      close: () => userEvent.unhover(button(2)),
    })
  })
})
