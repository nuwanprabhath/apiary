import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { asSessionId } from '@shared/domain/ids'
import type { ScheduledMessage, ScheduleNotice } from '@shared/domain/schedule'
import { STANDARD_SESSIONS as STD } from '../../fixtures/standard'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

const TITLE = STD.csv.title
const MINUTE = 60_000
const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const q = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`)
const press = async (keys: string): Promise<void> => { await userEvent.keyboard(keys) }

function scheduled(id: string, text: string, inMinutes: number): ScheduledMessage {
  return { id, sessionId: asSessionId(STD.csv.id), text, at: Date.now() + inMinutes * MINUTE, createdAt: Date.now() }
}

async function openPopup(): Promise<void> {
  await userEvent.click(sidebarSession(TITLE), { button: 'right' })
  await userEvent.click(page.getByTestId('context-menu-schedule-message'))
  await until(() => (q('schedule-time') as HTMLInputElement | null)?.value !== '')
}

async function openChat(): Promise<void> {
  await userEvent.click(sidebarSession(TITLE))
  await until(() => q('composer') !== null)
}

const popupOpen = { open: openPopup, close: () => press('{Escape}') }

describe('UI: scheduled messages', () => {
  it('the popup, new, with no limit known', async () => {
    await renderApp()
    await reviewUi('schedule popup new', popupOpen)
  })

  it('the popup, new, 5 minutes after the limit resets, without OS jobs', async () => {
    const resetsAt = Date.now() + 3 * 60 * MINUTE
    await renderApp({ scheduleDefault: { at: resetsAt + 5 * MINUTE, source: 'transcript', resetsAt }, schedules: { osJobs: false } })
    await reviewUi('schedule popup limit default', popupOpen)
  })

  it('the popup, editing a long message, with an error', async () => {
    await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_A, 'Please carry on with the CSV exporter fix where you stopped, then run the whole test suite and tell me what failed', 45)] } })
    await openChat()
    await reviewUi('schedule popup edit', {
      open: async () => {
        await userEvent.click(page.getByTestId('schedule-chip'))
        await userEvent.click(page.getByTestId('context-menu-schedule-edit'))
        await until(() => q('schedule-dialog') !== null)
        await userEvent.fill(page.getByTestId('schedule-date'), '')
        await userEvent.click(page.getByTestId('schedule-save'))
        await until(() => q('schedule-error') !== null)
      },
      close: () => press('{Escape}'),
    })
  })

  it('the chip, one schedule, and its menu', async () => {
    await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_A, 'continue', 30)] } })
    await openChat()
    await until(() => q('schedule-chip') !== null)
    await reviewUi('schedule chip one', { widths: [620, 1000] })
    await reviewUi('schedule chip menu', {
      widths: [620, 1000],
      open: async () => { await userEvent.click(page.getByTestId('schedule-chip')); await until(() => q('schedule-menu') !== null) },
      close: () => press('{Escape}'),
    })
  })

  it('the chip, two schedules, with notices above it', async () => {
    const notices: ScheduleNotice[] = [
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', sessionId: asSessionId(STD.csv.id), text: 'continue', at: Date.now() - 30 * MINUTE, ok: true, whileClosed: true, detail: null },
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', sessionId: asSessionId(STD.csv.id), text: 'go on', at: Date.now() - 10 * MINUTE, ok: false, whileClosed: true, detail: 'API Error: 429 You have hit your session limit · resets 3pm (Australia/Adelaide)' },
    ]
    await renderApp({ settings: { transcriptChat: true }, schedules: { messages: [scheduled(ID_A, 'continue', 30), scheduled(ID_B, 'and then the docs', 24 * 60)], notices } })
    await openChat()
    await until(() => q('schedule-chip') !== null)
    await reviewUi('schedule chip many with notices', {
      widths: [620, 1000],
      open: async () => { await userEvent.click(page.getByTestId('schedule-chip')); await until(() => q('schedule-menu') !== null) },
      close: () => press('{Escape}'),
    })
  })

  it('the sidebar row with a schedule', async () => {
    await renderApp({ schedules: { messages: [scheduled(ID_A, 'continue', 30)] } })
    await until(() => q('session-schedule-mark') !== null)
    await reviewUi('schedule sidebar clock', { widths: [900] })
  })
})
