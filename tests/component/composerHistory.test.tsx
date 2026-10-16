import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { message } from './fakeApiary'

/** A session where you have already sent two messages (the second twice in a row). */
async function openWithHistory(): Promise<HTMLTextAreaElement> {
  await renderApp({
    sessions: [{
      sessionId: '88888888-8888-8888-8888-888888888888',
      title: 'Has a history',
      projectPath: '/fixture/work-a',
      messages: [
        message('u1', 'user', 'first ask'),
        message('a1', 'assistant', 'done'),
        message('u2', 'user', 'second ask'),
        message('a2', 'assistant', 'done again'),
        message('u3', 'user', 'second ask'),
      ],
    }],
  })
  await userEvent.click(sidebarSession('Has a history'))
  await userEvent.click(page.getByTestId('composer-input'))
  return page.getByTestId('composer-input').element() as HTMLTextAreaElement
}

describe('message box history', () => {
  it('Up goes back through what was sent, Down comes forward, and past the newest the draft returns', async () => {
    const box = await openWithHistory()
    await userEvent.type(box, 'my draft')

    await userEvent.keyboard('{ArrowUp}')
    await until(() => box.value === 'second ask')
    // The same message sent twice in a row is one entry, as in a shell.
    await userEvent.keyboard('{ArrowUp}')
    await until(() => box.value === 'first ask')
    await userEvent.keyboard('{ArrowUp}')
    expect(box.value).toBe('first ask')

    await userEvent.keyboard('{ArrowDown}')
    await until(() => box.value === 'second ask')
    await userEvent.keyboard('{ArrowDown}')
    await until(() => box.value === 'my draft')
  })

  it('leaves Up to the caret when it is not on the first line', async () => {
    const box = await openWithHistory()
    await userEvent.fill(box, 'line one\nline two')
    box.setSelectionRange(box.value.length, box.value.length)
    await userEvent.keyboard('{ArrowUp}')
    expect(box.value).toBe('line one\nline two')
  })
})

const LONG = 'a long sentence with no newline that the narrow box wraps onto several visual lines of its own'

describe('message box history on a wrapped line', () => {
  it('Up from the second visual line moves the caret; only the first visual line recalls', async () => {
    const box = await openWithHistory()
    box.style.width = '120px'
    await userEvent.fill(box, LONG)
    box.setSelectionRange(box.value.length, box.value.length)
    await userEvent.keyboard('{ArrowUp}')
    expect(box.value).toBe(LONG)
    box.setSelectionRange(3, 3)
    await userEvent.keyboard('{ArrowUp}')
    await until(() => box.value === 'second ask')
  })

  it('Down from the first visual line of a recalled wrapped message does not step forward', async () => {
    await renderApp({
      sessions: [{
        sessionId: '99999999-9999-9999-9999-999999999999',
        title: 'Wrapped history',
        projectPath: '/fixture/work-a',
        messages: [message('u1', 'user', LONG), message('a1', 'assistant', 'ok')],
      }],
    })
    await userEvent.click(sidebarSession('Wrapped history'))
    await userEvent.click(page.getByTestId('composer-input'))
    const box = page.getByTestId('composer-input').element() as HTMLTextAreaElement
    box.style.width = '120px'
    await userEvent.keyboard('{ArrowUp}')
    await until(() => box.value === LONG)
    box.setSelectionRange(2, 2)
    await userEvent.keyboard('{ArrowDown}')
    expect(box.value).toBe(LONG)
    box.setSelectionRange(box.value.length, box.value.length)
    await userEvent.keyboard('{ArrowDown}')
    await until(() => box.value === '')
  })
})
