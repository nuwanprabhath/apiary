import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { BackgroundTask } from '@shared/chatTimeline'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** The background-task line above the message box, and the popup listing each task (F, in 1.41). */
const TITLE = 'Fix CSV export bug'
const MIN = 60_000

const ONE: BackgroundTask[] = [
  { taskId: 'bluctp9gs', description: 'Watch the run:6 verification pipeline', kind: 'shell', command: 'gh run watch 6 --exit-status', startedAtMs: Date.now() - 3 * MIN },
]

const FOUR: BackgroundTask[] = [
  { taskId: 'a1c9f0e2d', description: 'Vertebrate/acoustic fauna webapp migration, including the survey forms and the offline sync queue', kind: 'agent', command: null, startedAtMs: Date.now() - 14 * MIN },
  { taskId: 'a7b2e4c81', description: 'Camera trap module migration and the image tagging workflow', kind: 'agent', command: null, startedAtMs: Date.now() - 12 * MIN },
  { taskId: 'a3d5f6b90', description: 'Pest/aerial survey migration', kind: 'agent', command: null, startedAtMs: Date.now() - 9 * MIN },
  { taskId: 'b8k2m4n6p', description: 'Run the full e2e suite in parallel', kind: 'shell', command: 'npx playwright test --project=parallel --reporter=line --workers=4 tests/e2e', startedAtMs: Date.now() - 192_000 },
]

const SHELL_LINES = [
  'Running 212 tests using 4 workers',
  '  ✓  1 [parallel] › sidebar.spec.ts:12:3 › lists the sessions (4.1s)',
  '  ✓  2 [parallel] › search.spec.ts:30:3 › finds a session by content (6.3s)',
  '  ✘  3 [parallel] › terminal.spec.ts:88:3 › resumes into a shell (12.0s)',
  '  ✓  4 [parallel] › themes.spec.ts:9:3 › switches to Paper (2.2s)',
]
const AGENT_LINES = [
  'Reading the camera trap module to see what the survey form depends on.',
  '→ Read  CameraTrapForm.vue',
  '→ Grep  useOfflineQueue',
  'The form posts through the offline queue; moving it over first.',
  '→ Edit  cameraTrap.ts',
]

async function open(tasks: BackgroundTask[], outputs: Record<string, { available: boolean; lines: string[] }> = {}): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  for (const [taskId, out] of Object.entries(outputs)) fake.state.taskOutputs.set(`${sessionId}:${taskId}`, out)
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const, backgroundTasks: tasks }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', { kind: 'full', state: next })
  await expect.element(page.getByTestId('chat-status-tasks')).toBeVisible()
}

const outputShows = (text: string) => async (): Promise<void> => {
  await until(() => [...document.querySelectorAll('[data-testid="chat-task-output"]')].some((e) => e.textContent?.includes(text) === true))
}

async function openPopup(): Promise<void> {
  if (document.querySelector('[data-testid="chat-tasks-popup"]') === null) await userEvent.click(page.getByTestId('chat-status-tasks'))
  await expect.element(page.getByTestId('chat-tasks-popup')).toBeVisible()
}

async function expandRow(taskId: string, shows: string): Promise<void> {
  await openPopup()
  const row = document.querySelector(`[data-task-id="${taskId}"]`)!
  if (row.getAttribute('aria-expanded') !== 'true') await userEvent.click(row.querySelector('.chat-task-head')!)
  await outputShows(shows)()
}

describe('UI background tasks', () => {
  it('one task', async () => {
    await open(ONE)
    await reviewUi('background tasks one')
  })

  it('four tasks with long descriptions', async () => {
    await open(FOUR)
    await reviewUi('background tasks four')
  })

  it('popup open, a shell row expanded', async () => {
    await open(FOUR, { b8k2m4n6p: { available: true, lines: SHELL_LINES } })
    await reviewUi('background tasks shell output', { open: () => expandRow('b8k2m4n6p', 'Running 212 tests') })
  })

  it('popup open, an agent row expanded', async () => {
    await open(FOUR, { a7b2e4c81: { available: true, lines: AGENT_LINES } })
    await reviewUi('background tasks agent output', { open: () => expandRow('a7b2e4c81', 'offline queue') })
  })

  it('popup open, empty output', async () => {
    await open(ONE, { bluctp9gs: { available: true, lines: [] } })
    await reviewUi('background tasks empty output', { open: () => expandRow('bluctp9gs', 'No output yet.') })
  })

  it('popup in a narrow pane', async () => {
    await open(FOUR, { a1c9f0e2d: { available: false, lines: [] } })
    await reviewUi('background tasks narrow', { widths: [620], open: () => expandRow('a1c9f0e2d', "isn't available") })
  })
})
