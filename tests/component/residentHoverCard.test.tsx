import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { mrDeskStatus, regentStatus, withMrDesk, withRegent } from './residentFixtures'

const badge = (id: string): HTMLElement | null => document.querySelector(`[data-testid="resident-badge-${id}"]`)
const card = (id: string): HTMLElement | null => document.querySelector(`[data-testid="resident-hover-${id}"]`)
const line = (id: string, name: string): string | null =>
  card(id)?.querySelector(`[data-testid="resident-hover-${name}"] .resident-hover-text`)?.textContent ?? null

describe('the resident badge pill', () => {
  it('shows the activity while working, and "Working…" when there is none', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge('regent')?.dataset.state === 'idle')
    const pill = (): string | null => badge('regent')!.querySelector('.resident-activity')!.textContent
    fake.emit('residentsChanged', [regentStatus('working', 'Running glab mr view')])
    await expect.poll(pill).toBe('Running glab mr view')
    fake.emit('residentsChanged', [regentStatus('working', null)])
    await expect.poll(pill).toBe('Working…')
  })
})

describe('the resident hover card', () => {
  it('says what Regent is and what it is doing, with the digest', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge('regent') !== null)
    fake.emit('residentsChanged', [{ ...regentStatus('working', 'Reading API auth'), digest: { done: 612, total: 840 }, attention: { count: 2, summary: '2 MRs ready' } }])
    await userEvent.hover(badge('regent')!)
    await until(() => card('regent') !== null)
    expect(card('regent')!.querySelector('.hover-card-title')!.textContent).toBe('Regent')
    expect(card('regent')!.querySelector('.resident-hover-blurb')!.textContent).toMatch(/chief of staff/)
    expect(line('regent', 'now')).toBe('Reading API auth')
    expect(line('regent', 'needs')).toBe('2 MRs ready')
    expect(line('regent', 'digest')).toBe('612 of 840')
    expect(line('regent', 'checks')).toBeNull()
    await userEvent.unhover(badge('regent')!)
    await until(() => card('regent') === null)
  })

  it('the MR desk shows its checks, and "Running a check now" during one', async () => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 45).getTime()
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => badge('mr-desk') !== null)
    fake.emit('residentsChanged', [mrDeskStatus('idle', { cycle: { everyMinutes: 15, nextAt: next, running: false }, setupNeeded: 'Run `glab auth login` in a terminal' })])
    await userEvent.hover(badge('mr-desk')!)
    await until(() => line('mr-desk', 'checks') !== null)
    expect(line('mr-desk', 'now')).toBe('Idle')
    expect(line('mr-desk', 'checks')).toBe('Every 15 min · next at 14:45')
    expect(line('mr-desk', 'setup')).toBe('Run `glab auth login` in a terminal')
    fake.emit('residentsChanged', [mrDeskStatus('working', { activity: 'Running mra prompt 1559', cycle: { everyMinutes: 15, nextAt: next, running: true } })])
    await until(() => line('mr-desk', 'checks') === 'Running a check now')
  })

  it('asleep says until when, and focus from the keyboard shows it', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge('regent') !== null)
    // The fake's Regent is on duty every day; this one is never on duty, so it says "off duty".
    fake.emit('residentsChanged', [{ ...regentStatus('asleep'), enabled: true, onDuty: false }])
    // A key press first, so the focus that follows counts as the keyboard's (`:focus-visible`).
    await userEvent.keyboard('{Shift}')
    badge('regent')!.focus()
    await until(() => card('regent') !== null)
    expect(line('regent', 'now')).toMatch(/^Asleep \(off duty/)
    expect(badge('regent')!.getAttribute('aria-describedby')).toBe('resident-hover-regent')
  })
})
