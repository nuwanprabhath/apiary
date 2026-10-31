import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { mouse, until } from '../helpers'
import { message, mrDeskStatus, regentStatus, withMrDesk, withRegent } from '../residentFixtures'
import { reviewUi } from './review'

const badge = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="resident-badge-${id}"]`)
const hoverCard = (id: string): Element | null => document.querySelector(`[data-testid="resident-hover-${id}"]`)
const popup = (): Element | null => document.querySelector('[data-testid="resident-popup"]')
/** Hovers the badge with the real mouse until its card is up: `reviewUi` parks the pointer before each width and theme. */
const hoverOpen = (id: string) => async (): Promise<void> => {
  const r = badge(id)!.getBoundingClientRect()
  await mouse.move(r.x + r.width / 2, r.y + r.height / 2, 3)
  await until(() => hoverCard(id) !== null)
}
const todayAt = (hh: number, mm: number): number => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm).getTime()
}

/** What a resident is and is doing: the hover card on each kind, and the popup's working line. */
describe('UI: what a resident is doing', () => {
  it('Regent working, hover card open', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge('regent') !== null)
    fake.emit('residentsChanged', [{
      ...regentStatus('working', 'Reading API auth'), digest: { done: 612, total: 840 }, attention: { count: 2, summary: '2 MRs are ready to approve' },
    }])
    await reviewUi('resident hover regent working', { widths: [620, 1000], open: hoverOpen('regent') })
  })

  it('MR desk with a cycle and setup needed, hover card open', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => badge('mr-desk') !== null)
    fake.emit('residentsChanged', [mrDeskStatus('idle', {
      cycle: { everyMinutes: 15, nextAt: todayAt(14, 45), running: false }, setupNeeded: 'Run `glab auth login` in a terminal',
    })])
    await reviewUi('resident hover mr desk cycle', { widths: [620, 1000], open: hoverOpen('mr-desk') })
  })

  it('asleep, hover card open', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge('regent') !== null)
    fake.emit('residentsChanged', [{ ...regentStatus('asleep'), enabled: true, onDuty: false }])
    await reviewUi('resident hover asleep', { widths: [620, 1000], open: hoverOpen('regent') })
  })

  it('the popup mid-cycle, with a working line and no streaming answer', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => badge('mr-desk') !== null)
    await userEvent.click(badge('mr-desk')!)
    await until(() => popup() !== null)
    fake.emit('residentMessage', { residentId: 'mr-desk', message: message('user', 'Run one MR desk cycle.') })
    fake.emit('residentsChanged', [mrDeskStatus('working', {
      activity: 'Running mra prompt 1559', cycle: { everyMinutes: 15, nextAt: todayAt(14, 45), running: true },
    })])
    await until(() => popup()!.querySelector('[data-testid="resident-working"]') !== null)
    await reviewUi('resident popup mid-cycle', { widths: [620, 1000], within: popup })
  })
})
