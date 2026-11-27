import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { stays, until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { must } from './must'

const TITLE = '!1776 #3258 Staging failed to update error'
const GITLAB = { forge: 'gitlab', webUrl: 'https://gitlab.com/group/project' } as const

async function openTitled(withRepo: boolean): Promise<FakeApiary> {
  const { fake } = await renderApp(
    { sessions: [{ sessionId: '6f1c2a40-1b2c-4d3e-8f90-0a1b2c3d4e60', title: TITLE, projectPath: '/fixture/repo-c' }] },
    (f) => {
      f.override('gitlabMrRefStatus', async () => ({ 1776: 'merged' }))
      const project = must(f.state.projects.find((p) => p.path === '/fixture/repo-c'))
      if (withRepo) project.webLocation = GITLAB
    },
  )
  await userEvent.click(page.getByTestId('sidebar').getByText('Staging failed to update error', { exact: false }).last())
  await until(() => page.getByTestId('session-title').elements().length > 0)
  return fake
}

const titleLinks = (): Array<[string, string]> =>
  [...page.getByTestId('session-title').element().querySelectorAll('a.ref-link')].map((a) => [a.textContent, a.getAttribute('href') ?? ''])

describe('a session title naming an MR and an issue', () => {
  it('links each to the session\'s GitLab project, the MR keeping its state', async () => {
    await openTitled(true)
    await expect.poll(titleLinks).toEqual([
      ['!1776 (merged)', 'https://gitlab.com/group/project/-/merge_requests/1776'],
      ['#3258', 'https://gitlab.com/group/project/-/issues/3258'],
    ])
    expect(page.getByTestId('session-title').element().textContent).toContain('Staging failed to update error')
  })

  it('a click opens the link in the browser and does not start a rename', async () => {
    const fake = await openTitled(true)
    await expect.poll(titleLinks).toHaveLength(2)
    await userEvent.click(must(page.getByTestId('session-title').element().querySelectorAll<HTMLElement>('a.ref-link')[1]))
    await until(() => fake.callsTo('openTerminalLink').length === 1)
    expect(fake.callsTo('openTerminalLink')[0]).toEqual(['https://gitlab.com/group/project/-/issues/3258'])
    expect(document.querySelector('[data-testid="session-title-input"]')).toBeNull()
  })

  it('stays plain text when main knows no repository page', async () => {
    await openTitled(false)
    await stays(() => titleLinks().length === 0, 300, 'no links without a repository')
  })
})
