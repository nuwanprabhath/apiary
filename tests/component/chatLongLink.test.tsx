import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { message } from './fakeApiary'
import { sidebarSession, until } from './helpers'

const LINK = 'https://gitlab.com/example-group/example-project/-/pipelines/3072612345678901234567890?ref=feature/a-very-long-branch-name-without-spaces'

async function open(chat: boolean): Promise<void> {
  await page.viewport(620, 800)
  await renderApp({
    settings: { transcriptChat: chat },
    sessions: [{
      sessionId: 'linked',
      title: 'Linked session',
      projectPath: '/fixture/repo-c',
      messages: [
        message('u1', 'user', `I got email saying this failed, so watch pipelines. ${LINK}`),
        message('a1', 'assistant', `Watching ${LINK} now.`),
      ],
    }],
  })
  await userEvent.click(sidebarSession('Linked session'))
  await until(() => document.querySelectorAll('a[href^="https://gitlab.com"]').length >= 2)
}

/** How far past its box's right edge any link, or the box's content, reaches (0: none does). */
function overflowPast(box: string): number[] {
  const boxes = [...document.querySelectorAll<HTMLElement>(box)]
  if (boxes.length === 0) throw new Error(`no ${box} on screen`)
  return boxes.map((el) => {
    const right = el.getBoundingClientRect().right
    const links = [...el.querySelectorAll('a')].flatMap((a) => [...a.getClientRects()].map((r) => r.right - right))
    return Math.max(0, el.scrollWidth - el.clientWidth - 1, ...links.map((d) => d - 0.5))
  })
}

describe('a long link with nowhere to break', () => {
  it('wraps inside your message bubble and Claude\'s reply in the chat', async () => {
    await open(true)
    expect(overflowPast('[data-testid="chat-user"]')).toEqual([0])
    expect(overflowPast('[data-testid="chat-text"] .chat-row-body')).toEqual([0])
  })

  it('wraps inside each message of the plain transcript', async () => {
    await open(false)
    expect(overflowPast('[data-testid="message"]').every((px) => px === 0)).toBe(true)
  })
})
