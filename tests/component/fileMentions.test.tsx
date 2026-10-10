import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { message, type FakeSession } from './fakeApiary'
import { sidebarSession, stays, until } from './helpers'

const SESSION: FakeSession = {
  sessionId: '00000000-0000-4000-8000-0000000000f1',
  title: 'Mentions chat',
  projectPath: '/fixture/work-a',
  gitBranch: 'main',
  messages: [
    message('u1', 'user', 'Where is the draft?'),
    message('a1', 'assistant',
      'See `src/app.ts:12` and draft-2642-2160-comments.md for the notes, or [the site](https://example.com). '
      + 'Visit example.com, not a file. The `npm run build` command is not a file.\n\n```\nsrc/inside-block.ts\n```'),
  ],
}

const mentions = (): string[] => [...document.querySelectorAll('[data-file-mention]')].map((e) => e.getAttribute('data-file-mention') ?? '')

async function openChat(vsCode: boolean): Promise<Awaited<ReturnType<typeof renderApp>>['fake']> {
  const { fake } = await renderApp({ sessions: [SESSION], vsCode })
  await userEvent.click(sidebarSession('Mentions chat'))
  await until(() => page.getByTestId('message').elements().length > 1)
  return fake
}

describe('file names in the transcript', () => {
  it('become links when VS Code is available: inline code and names in running text, nothing else', async () => {
    await openChat(true)
    await expect.poll(mentions).toEqual(['src/app.ts:12', 'draft-2642-2160-comments.md'])
  })

  it('stay plain text when VS Code is not available', async () => {
    await openChat(false)
    await stays(() => mentions().length === 0, 300, 'no file links without VS Code')
    expect(document.querySelectorAll('.file-mention').length).toBe(0)
  })

  it('a click sends the session and the text as written, nothing resolved', async () => {
    const fake = await openChat(true)
    await expect.poll(mentions).toHaveLength(2)
    await userEvent.click(document.querySelectorAll<HTMLElement>('[data-file-mention]')[1])
    await until(() => fake.callsTo('openMentionedFile').length === 1)
    expect(fake.callsTo('openMentionedFile')[0]).toEqual([{ kind: 'session', id: SESSION.sessionId }, 'draft-2642-2160-comments.md'])
  })

  it('Enter on a focused link opens it too', async () => {
    const fake = await openChat(true)
    await expect.poll(mentions).toHaveLength(2)
    document.querySelectorAll<HTMLElement>('[data-file-mention]')[0].focus()
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('openMentionedFile').length === 1)
    expect(fake.callsTo('openMentionedFile')[0][1]).toBe('src/app.ts:12')
  })
})
