import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { BackgroundTask } from '@shared/chatTimeline'

/** The line above the message box while background tasks run, and the popup it opens. */
const TITLE = 'Fix CSV export bug'

const LONG = 'Vertebrate and acoustic fauna webapp migration, with the camera trap and pest aerial modules moved over too'

const TASKS: BackgroundTask[] = [
  { taskId: 'bq1', description: 'Run the e2e suite', kind: 'shell', command: 'npm run test:e2e -- --project=parallel', startedAtMs: Date.now() - 192_000 },
  { taskId: 'a4f9c2e1b', description: 'Camera trap migration', kind: 'agent', command: null, startedAtMs: Date.now() - 65_000 },
]

async function openWithTasks(tasks: BackgroundTask[], arrange?: (fake: FakeApiary, sessionId: string) => void): Promise<{ fake: FakeApiary; sessionId: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  arrange?.(fake, sessionId)
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  const next = { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const, backgroundTasks: tasks }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', next)
  await expect.element(page.getByTestId('chat-status-tasks')).toBeVisible()
  return { fake, sessionId }
}

/** The text of every open task output, together. */
const output = (): string => [...document.querySelectorAll('[data-testid="chat-task-output"]')].map((e) => e.textContent).join('|')

describe('background tasks', () => {
  it('centres its text and chevron on the line, not along the top', async () => {
    await openWithTasks(TASKS)
    const line = document.querySelector<HTMLElement>('[data-testid="chat-status-tasks"]')!
    const middle = (el: Element): number => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }
    const parts = ['.chat-status-count', '.chat-status-detail', '.chat-status-chevron svg', '.chat-status-pulse']
    // How far each part's middle is from the line's, to the nearest pixel: all of them on the line.
    const offsets = Object.fromEntries(parts.map((p) => [p, Math.abs(Math.round(middle(line.querySelector(p)!) - middle(line)))]))
    expect(offsets).toEqual(Object.fromEntries(parts.map((p) => [p, 0])))
  })

  it('says how many run and the first one, on one line that never wraps however long it is', async () => {
    await openWithTasks([{ ...TASKS[0], description: LONG }, ...TASKS.slice(1)])
    const line = document.querySelector<HTMLElement>('[data-testid="chat-status-tasks"]')!
    expect(line.tagName).toBe('BUTTON')
    expect(line.getAttribute('aria-haspopup')).toBe('dialog')
    expect(line.textContent).toMatch(/^2 background tasks running · Vertebrate/)
    const lineHeight = parseFloat(getComputedStyle(line.querySelector('.chat-status-count')!).lineHeight)
    expect(line.getBoundingClientRect().height).toBeLessThan(lineHeight * 2)
    expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth + 1)
  })

  it('opens a popup listing each task with its command and how long it has run, and closes on Escape back to the line', async () => {
    await openWithTasks(TASKS)
    await userEvent.click(page.getByTestId('chat-status-tasks'))
    await expect.element(page.getByTestId('chat-tasks-popup')).toBeVisible()
    expect(page.getByTestId('chat-status-tasks').element().getAttribute('aria-expanded')).toBe('true')
    const rows = document.querySelectorAll('[data-testid="chat-task"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Run the e2e suite')
    expect(rows[0].textContent).toContain('npm run test:e2e -- --project=parallel')
    expect(rows[0].querySelector('[data-testid="chat-task-elapsed"]')?.textContent).toMatch(/^3m 1\ds$/)
    expect(rows[0].textContent).toContain('bq1')
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('chat-tasks-popup')).not.toBeInTheDocument()
    await until(() => document.activeElement === page.getByTestId('chat-status-tasks').element())
  })

  it('expands one row at a time to the end of its output, read from main, and says when there is none', async () => {
    await openWithTasks(TASKS, (fake, id) => {
      fake.state.taskOutputs.set(`${id}:bq1`, { available: true, lines: ['Running 212 tests', '  ✓ sidebar (4s)'] })
      fake.state.taskOutputs.set(`${id}:a4f9c2e1b`, { available: true, lines: [] })
    })
    await userEvent.click(page.getByTestId('chat-status-tasks'))
    await userEvent.click(page.getByTestId('chat-task').first())
    await expect.poll(output).toBe('Running 212 tests\n  ✓ sidebar (4s)')
    // Arrow down and Enter: the next row opens and the first closes.
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect.poll(output).toBe('No output yet.')
    expect(document.querySelectorAll('[data-testid="chat-task-output"]')).toHaveLength(1)
    // Space toggles too.
    await userEvent.keyboard('{ArrowUp} ')
    await expect.poll(output).toBe('Running 212 tests\n  ✓ sidebar (4s)')
  })

  it("says a task's output is not available when main cannot read it", async () => {
    await openWithTasks(TASKS)
    await userEvent.click(page.getByTestId('chat-status-tasks'))
    await userEvent.click(page.getByTestId('chat-task').first())
    await expect.poll(output).toBe("Output isn't available.")
  })
})
