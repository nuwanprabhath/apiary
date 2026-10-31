import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { ResidentStatus } from '@shared/domain/residents'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { regentStatus, withRegent } from './residentFixtures'

/**
 * The words a resident shows for a status, everywhere it shows them: the badge's pill, the popup's
 * header, the popup's working line and the hover card's lines. A table of statuses in, the visible
 * text out; while working, the pill is never empty.
 */

interface Words {
  pill: string
  header: string
  working: string | null
  card: Record<string, string>
}

const PERMISSION = { requestId: 'r1', tool: 'Bash', summary: 'Run: glab mr view 1047' }
const ATTENTION = { count: 2, summary: '2 MRs ready to approve' }

const ROWS: { name: string; status: Partial<ResidentStatus> & Pick<ResidentStatus, 'state'>; words: Words }[] = [
  {
    name: 'working on a tool',
    status: { state: 'working', activity: 'Running mra prompt 1559' },
    words: { pill: 'Running mra prompt 1559', header: 'Running mra prompt 1559', working: 'Running mra prompt 1559', card: { now: 'Running mra prompt 1559' } },
  },
  {
    name: 'working with no activity',
    status: { state: 'working', activity: null },
    words: { pill: 'Working…', header: 'Working…', working: 'Working…', card: { now: 'Working…' } },
  },
  {
    name: 'working while it needs you',
    status: { state: 'working', activity: 'Helper: reviewing !1559', attention: ATTENTION },
    words: { pill: 'Helper: reviewing !1559', header: 'Helper: reviewing !1559', working: 'Helper: reviewing !1559', card: { now: 'Helper: reviewing !1559', needs: ATTENTION.summary } },
  },
  {
    name: 'idle',
    status: { state: 'idle' },
    words: { pill: '', header: 'idle', working: null, card: { now: 'Idle' } },
  },
  {
    name: 'idle, needing you',
    status: { state: 'idle', attention: ATTENTION },
    words: { pill: ATTENTION.summary, header: 'idle', working: null, card: { now: 'Idle', needs: ATTENTION.summary } },
  },
  {
    name: 'idle, a permission waiting',
    status: { state: 'idle', permissions: [PERMISSION] },
    words: { pill: 'Waiting for your OK', header: 'idle', working: null, card: { now: 'Idle', needs: '1 · Waiting for your OK' } },
  },
  {
    name: 'turned off',
    status: { state: 'asleep', enabled: false },
    words: { pill: '', header: 'asleep', working: null, card: { now: 'Asleep (turned off)' } },
  },
  {
    name: 'setup needed, with a cycle',
    status: { state: 'idle', setupNeeded: 'Set the GitLab project', cycle: { everyMinutes: 15, nextAt: null, running: false } },
    words: { pill: '', header: 'idle', working: null, card: { now: 'Idle', checks: 'Every 15 min', setup: 'Set the GitLab project' } },
  },
  {
    name: 'running a check',
    status: { state: 'working', activity: 'Running mra poll', cycle: { everyMinutes: 5, nextAt: null, running: true } },
    words: { pill: 'Running mra poll', header: 'Running mra poll', working: 'Running mra poll', card: { now: 'Running mra poll', checks: 'Running a check now' } },
  },
  {
    name: 'digesting',
    status: { state: 'working', activity: null, digest: { done: 3, total: 10 } },
    words: { pill: 'Working…', header: 'Working…', working: 'Working…', card: { now: 'Working…', digest: '3 of 10' } },
  },
]

const badge = (): HTMLElement | null => document.querySelector('[data-testid="resident-badge-regent"]')
const pill = (): string => badge()!.querySelector('.resident-activity')!.textContent ?? ''
const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
const header = (): string | null => popup()?.querySelector('.resident-popup-doing')?.textContent ?? null
const workingLine = (): string | null => popup()?.querySelector('[data-testid="resident-working"] .resident-streaming-text')?.textContent ?? null
const hasBusyGlyph = (): boolean => popup()?.querySelector('[data-testid="resident-working"] .busy-glyph') !== null
function cardLines(): Record<string, string> {
  const card = document.querySelector('[data-testid="resident-hover-regent"]')
  const lines: Record<string, string> = {}
  card?.querySelectorAll<HTMLElement>('.hover-card-row').forEach((row) => {
    lines[row.dataset.testid!.replace('resident-hover-', '')] = row.querySelector('.resident-hover-text')!.textContent ?? ''
  })
  return lines
}

describe('a resident\'s words', () => {
  it.each(ROWS)('$name', async ({ status, words }) => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge() !== null)
    const full: ResidentStatus = { ...regentStatus(status.state), ...status }
    fake.emit('residentsChanged', [full])
    await expect.poll(pill).toBe(words.pill)
    expect(full.state !== 'working' || pill() !== '').toBe(true)

    await userEvent.hover(badge()!)
    await expect.poll(cardLines).toEqual(words.card)
    await userEvent.unhover(badge()!)

    await userEvent.click(badge()!)
    await until(() => popup() !== null)
    // Opening the popup tells main it was seen, which clears the attention: the status comes again.
    fake.emit('residentsChanged', [full])
    await expect.poll(header).toBe(words.header)
    await expect.poll(workingLine).toBe(words.working)
    expect(hasBusyGlyph()).toBe(words.working !== null)
  })
})
