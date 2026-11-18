import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { message, type FakeApiary, type FakeSession } from './fakeApiary'
import { sidebarSession, stays, until } from './helpers'
import { must } from './must'

const SESSION: FakeSession = {
  sessionId: '00000000-0000-4000-8000-0000000000f2',
  title: 'Reference chat',
  projectPath: '/fixture/work-a',
  gitBranch: 'main',
  messages: [
    message('u1', 'user', 'What is left?'),
    message('a1', 'assistant', 'see #3202 and !1713 and src/app.ts, but not `#3202` in code'),
  ],
}

const GITLAB = { forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' } as const

const refLinks = (): Array<[string, string]> =>
  [...document.querySelectorAll('a.ref-link')].map((a) => [a.textContent, a.getAttribute('href') ?? ''])

async function openChat(withRepo: boolean): Promise<FakeApiary> {
  const { fake } = await renderApp({ sessions: [SESSION], vsCode: true }, (f) => {
    const project = must(f.state.projects.find((p) => p.path === SESSION.projectPath))
    if (withRepo) project.webLocation = GITLAB
  })
  await userEvent.click(sidebarSession('Reference chat'))
  await until(() => page.getByTestId('message').elements().length > 1)
  return fake
}

describe('references in a message', () => {
  it('link #N and !N to the session\'s GitLab project and keep the file mention; code stays text', async () => {
    await openChat(true)
    await expect.poll(refLinks).toEqual([
      ['#3202', 'https://gitlab.com/group/project/-/issues/3202'],
      ['!1713', 'https://gitlab.com/group/project/-/merge_requests/1713'],
    ])
    const link = must(document.querySelector('a.ref-link'))
    expect(link.getAttribute('title')).toBe('https://gitlab.com/group/project/-/issues/3202')
    expect([...document.querySelectorAll('[data-file-mention]')].map((e) => e.textContent)).toEqual(['src/app.ts'])
    expect(must(document.querySelector('.markdown code')).querySelector('a')).toBeNull()
  })

  it('a click opens the link through main, on the machine in front of the person', async () => {
    const fake = await openChat(true)
    await expect.poll(refLinks).toHaveLength(2)
    await userEvent.click(must(document.querySelectorAll<HTMLElement>('a.ref-link')[1]))
    await until(() => fake.callsTo('openTerminalLink').length === 1)
    expect(fake.callsTo('openTerminalLink')[0]).toEqual(['https://gitlab.com/group/project/-/merge_requests/1713'])
  })

  it('are plain text when main knows no repository page', async () => {
    await openChat(false)
    await expect.poll(() => document.querySelectorAll('[data-file-mention]').length).toBe(1)
    await stays(() => refLinks().length === 0, 300, 'no reference links without a repository')
  })
})
