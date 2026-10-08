import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { ErrorBoundary } from '../../src/renderer/ui/ErrorBoundary'
import { expectConsoleError } from './setup'
import { mountUi } from './mountUi'

function Bomb({ explode }: { explode: boolean }): React.JSX.Element {
  if (explode) throw new Error('DELIBERATE_BOMB')
  return <p data-testid="fine">all good</p>
}

describe('ErrorBoundary resetKey (UI-24 follow-up)', () => {
  it('tries again by itself when the key changes, and not before', async () => {
    expectConsoleError(/DELIBERATE_BOMB/)
    const ui = (key: string, explode: boolean): React.JSX.Element => (
      <ErrorBoundary resetKey={key}><Bomb explode={explode} /></ErrorBoundary>
    )
    const m = await mountUi(ui('a', true))
    await expect.element(page.getByTestId('crash-pane')).toBeVisible()

    // The child is healthy now, but nothing told the boundary: it keeps showing the crash.
    await m.rerender(ui('a', false))
    await expect.element(page.getByTestId('crash-pane')).toBeVisible()

    // A new key (the pane was pointed at another session) is that signal.
    await m.rerender(ui('b', false))
    await expect.element(page.getByTestId('fine')).toBeVisible()
    expect(document.querySelector('[data-testid="crash-pane"]')).toBeNull()
  })

  it('shows the crash again if the retried children still throw, and a key change while healthy does nothing', async () => {
    expectConsoleError(/DELIBERATE_BOMB/)
    const ui = (key: string, explode: boolean): React.JSX.Element => (
      <ErrorBoundary resetKey={key}><Bomb explode={explode} /></ErrorBoundary>
    )
    const m = await mountUi(ui('a', false))
    await expect.element(page.getByTestId('fine')).toBeVisible()
    await m.rerender(ui('b', false))
    await expect.element(page.getByTestId('fine')).toBeVisible()

    await m.rerender(ui('b', true))
    await expect.element(page.getByTestId('crash-pane')).toBeVisible()
    await m.rerender(ui('c', true))
    await expect.element(page.getByTestId('crash-pane')).toBeVisible()
    // The button still works with no key at all.
    await userEvent.click(page.getByTestId('crash-retry'))
    await expect.element(page.getByTestId('crash-pane')).toBeVisible()
  })
})
