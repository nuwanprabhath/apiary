import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { MrState } from '@shared/domain/git'
import { renderApp } from './renderApp'
import { until } from './helpers'

const TITLE = '!1713 #2779 ResizeObserver loop posthog'

async function openWith(state: MrState): Promise<void> {
  await renderApp(
    { sessions: [{ sessionId: '6f1c2a40-1b2c-4d3e-8f90-0a1b2c3d4e5f', title: TITLE, projectPath: '/fixture/repo-c' }] },
    (fake) => { fake.override('gitlabMrRefStatus', async () => ({ 1713: state })) },
  )
  // The row already shows the state, so its text is no longer the title as written.
  await userEvent.click(page.getByTestId('sidebar').getByText('ResizeObserver loop posthog', { exact: false }).last())
}

/** The MR reference inside the element with this test id, once its state has landed. */
async function refIn(testId: string): Promise<Element> {
  const find = (): Element | null => page.getByTestId(testId).elements()[0]?.querySelector('.mr-ref') ?? null
  await until(() => find() !== null)
  const ref = find()
  if (ref === null) throw new Error(`no MR reference in ${testId}`)
  return ref
}

describe('a session titled with an MR', () => {
  it("its tab shows the MR's state, as the sidebar row does", async () => {
    await openWith('merged')
    const ref = await refIn('session-tab-label')
    expect(ref.textContent).toBe('!1713 (merged)')
    expect(ref.getAttribute('data-state')).toBe('merged')
  })

  it('its heading shows the state too', async () => {
    await openWith('opened')
    expect((await refIn('session-title')).textContent).toBe('!1713 (opened)')
  })
})
