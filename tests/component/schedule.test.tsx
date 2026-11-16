import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { asSessionId } from '@shared/domain/ids'
import type { ScheduledMessage, ScheduleNotice } from '@shared/domain/schedule'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

const TITLE = STD.csv.title
const SESSION = STD.csv.id
const MINUTE = 60_000
const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const q = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`)
const dialogOpen = (): boolean => q('schedule-dialog') !== null

function scheduled(id: string, text: string, inMinutes: number, extra: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return { id, sessionId: asSessionId(SESSION), text, at: Date.now() + inMinutes * MINUTE, createdAt: Date.now(), ...extra }
}

async function openFromSidebarMenu(): Promise<void> {
  await userEvent.click(sidebarSession(TITLE), { button: 'right' })
  await userEvent.click(page.getByTestId('context-menu-schedule-message'))
  await until(dialogOpen)
}

async function openChat(): Promise<void> {
  await userEvent.click(sidebarSession(TITLE))
  await until(() => q('composer') !== null)
}

describe('scheduling a message', () => {
  it('the sidebar menu opens the popup with the message field focused, an hour ahead when no limit is known', async () => {
    const { fake } = await renderApp()
    await openFromSidebarMenu()
    expect(document.activeElement).toBe(q('schedule-text'))
    await until(() => (q('schedule-time') as HTMLInputElement | null)?.value !== '')
    expect(q('schedule-pick-limit')).toBeNull()
    expect(q('schedule-source')?.textContent).toContain('No usage limit is known')
    await userEvent.fill(page.getByTestId('schedule-text'), 'keep going')
    await userEvent.click(page.getByTestId('schedule-save'))
    await until(() => !dialogOpen())
    const [request] = fake.callsTo('scheduleSet').at(-1) as [{ text: string; at: number; sessionId: string; id: string | null }]
    expect(request).toMatchObject({ text: 'keep going', sessionId: SESSION, id: null })
    expect(request.at).toBeGreaterThan(Date.now() + 55 * MINUTE)
    expect(fake.state.schedules.messages.map((m) => m.text)).toEqual(['keep going'])
  })

  it('suggests 5 minutes after the limit resets, says so, and an empty message sends “continue”', async () => {
    const resetsAt = Date.now() + 2 * 60 * MINUTE
    const { fake } = await renderApp({ scheduleDefault: { at: resetsAt + 5 * MINUTE, source: 'usage', resetsAt } })
    await openFromSidebarMenu()
    await until(() => q('schedule-pick-limit') !== null)
    expect(q('schedule-source')?.textContent).toContain('5 min after your limit resets at')
    expect(q('schedule-text')?.getAttribute('placeholder')).toBe('continue')
    await userEvent.click(page.getByTestId('schedule-pick-hour'))
    await userEvent.click(page.getByTestId('schedule-pick-limit'))
    await userEvent.click(page.getByTestId('schedule-save'))
    await until(() => !dialogOpen())
    const [request] = fake.callsTo('scheduleSet').at(-1) as [{ text: string; at: number }]
    expect(request.text).toBe('continue')
    expect(Math.abs(request.at - (resetsAt + 5 * MINUTE))).toBeLessThan(MINUTE)
  })

  it('shows main\'s refusal under the fields and keeps the popup open', async () => {
    const { fake } = await renderApp()
    fake.override('scheduleSet', () => Promise.reject(new Error('Pick a time in the future')))
    await openFromSidebarMenu()
    await until(() => (q('schedule-time') as HTMLInputElement | null)?.value !== '')
    await userEvent.click(page.getByTestId('schedule-save'))
    await until(() => q('schedule-error') !== null)
    expect(q('schedule-error')?.textContent).toContain('Pick a time in the future')
    expect(dialogOpen()).toBe(true)
  })

  it('the tab menu and the chat\'s "/" menu offer it too', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await openChat()
    await userEvent.click(page.getByTestId('session-tab').first(), { button: 'right' })
    await userEvent.click(page.getByTestId('context-menu-schedule-message'))
    await until(dialogOpen)
    await userEvent.click(page.getByTestId('schedule-cancel'))
    await until(() => !dialogOpen())
    await userEvent.fill(page.getByTestId('composer-input'), '/sched')
    await until(() => document.body.textContent.includes('Schedule a message…'))
    await userEvent.click(page.getByTestId('composer-action-option').filter({ hasText: 'Schedule a message…' }))
    await until(dialogOpen)
    expect(document.activeElement).toBe(q('schedule-text'))
  })
})

describe('the chip above the message box', () => {
  it('names one schedule, and its menu edits, sends now and cancels', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_A, 'continue', 30)] } })
    await openChat()
    await until(() => q('schedule-chip') !== null)
    expect(q('schedule-chip')?.textContent).toMatch(/Sends “continue” at \d+:\d\d [ap]m (today|tomorrow)/)
    expect(q('session-schedule-mark')).not.toBeNull()

    await userEvent.click(page.getByTestId('schedule-chip'))
    await userEvent.click(page.getByTestId('context-menu-schedule-edit'))
    await until(dialogOpen)
    expect((q('schedule-text') as HTMLTextAreaElement).value).toBe('continue')
    await userEvent.fill(page.getByTestId('schedule-text'), 'carry on')
    await userEvent.click(page.getByTestId('schedule-save'))
    await until(() => q('schedule-chip')?.textContent.includes('carry on') === true)
    expect((fake.callsTo('scheduleSet').at(-1) as [{ id: string }])[0].id).toBe(ID_A)

    await userEvent.click(page.getByTestId('schedule-chip'))
    await userEvent.click(page.getByTestId('context-menu-schedule-send-now'))
    await until(() => q('schedule-chip') === null)
    expect(fake.state.scheduleSent).toEqual([ID_A])
  })

  it('cancel takes the chip and the sidebar clock away; the edit popup can delete too', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_A, 'continue', 30)] } })
    await openChat()
    await until(() => q('schedule-chip') !== null)
    await userEvent.click(page.getByTestId('schedule-chip'))
    await userEvent.click(page.getByTestId('context-menu-schedule-cancel'))
    await until(() => q('schedule-chip') === null && q('session-schedule-mark') === null)
    expect(fake.callsTo('scheduleCancel')).toEqual([[ID_A]])
  })

  it('more than one reads "2 scheduled messages" and lists each with its own actions', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_B, 'second', 90), scheduled(ID_A, 'first', 30)] } })
    await openChat()
    await until(() => q('schedule-chip')?.textContent === '2 scheduled messages')
    await userEvent.click(page.getByTestId('schedule-chip'))
    await userEvent.click(page.getByTestId(`context-menu-schedule-${ID_A}`))
    await userEvent.click(page.getByTestId(`context-menu-${ID_A}-schedule-cancel`))
    await until(() => q('schedule-chip')?.textContent.includes('second') === true)
    expect(fake.callsTo('scheduleCancel')).toEqual([[ID_A]])
  })

  it('a missed schedule says so', async () => {
    await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_A, 'continue', -14 * 60, { missed: true })] } })
    await openChat()
    await until(() => q('schedule-chip') !== null)
    expect(q('schedule-chip')?.textContent).toContain('Missed: “continue” was due')
  })

  it('a message sent while Apiary was closed shows once, until dismissed; a failed one shows why', async () => {
    const sent: ScheduleNotice = { id: ID_A, sessionId: asSessionId(SESSION), text: 'continue', at: Date.now() - 10 * MINUTE, ok: true, whileClosed: true, detail: null }
    const failed: ScheduleNotice = { id: ID_B, sessionId: asSessionId(SESSION), text: 'go on', at: Date.now() - 5 * MINUTE, ok: false, whileClosed: true, detail: 'Error: You have hit your limit' }
    const { fake } = await renderApp({ settings: { transcriptChat: true }, schedules: { notices: [sent, failed] } })
    await openChat()
    await until(() => document.querySelectorAll('[data-testid="schedule-notice"]').length === 2)
    const rows = [...document.querySelectorAll('[data-testid="schedule-notice"]')].map((r) => r.textContent)
    expect(rows[0]).toContain('while Apiary was closed')
    expect(rows[1]).toContain('Could not send “go on”')
    expect(rows[1]).toContain('You have hit your limit')
    await userEvent.click(page.getByTestId('schedule-notice-dismiss').first())
    await until(() => document.querySelectorAll('[data-testid="schedule-notice"]').length === 1)
    expect(fake.callsTo('scheduleCancel')).toEqual([[ID_A]])
  })

  it('without OS jobs, the popup says it sends only while Apiary is open', async () => {
    await renderApp({ schedules: { osJobs: false } })
    await openFromSidebarMenu()
    await until(() => q('schedule-open-only') !== null)
    expect(q('schedule-open-only')?.textContent).toBe('Sends only while Apiary is open.')
  })
})
