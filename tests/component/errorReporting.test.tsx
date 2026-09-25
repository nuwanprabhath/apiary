import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

describe('error reporting', () => {
  it('an error nothing else caught still reaches the user', async () => {
    await renderApp()
    // The safety net: a rejected promise with no `.catch` anywhere reaches the window, and used to
    // end up only in a devtools console the user never opens.
    void Promise.reject(new Error('NOBODY_CAUGHT_THIS'))

    // Waited for directly: the notification reaches the DOM only after the browser's own
    // `unhandledrejection` event and React's state update, and `expect.element`'s first (failing)
    // poll on a not-yet-existing element trips a pretty-format recursion bug in this environment.
    await until(() => document.querySelector('[data-testid="notification"]') !== null)
    await expect.element(page.getByTestId('notification')).toBeVisible()
    await expect.element(page.getByTestId('notification')).toHaveTextContent('NOBODY_CAUGHT_THIS')
  })

  it('a crash while rendering a session is caught and explained, never left blank', async () => {
    await renderApp()
    // Two sessions open as tabs in the same column: only the active tab's transcript is mounted,
    // so switching between them unmounts one and mounts the other — a real DOM removal inside the
    // column's own subtree, which is what the sabotage below turns into a render-time throw.
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await expect.element(page.getByTestId('transcript')).toBeVisible()

    // The session heading's editable title is keyed by session id, so switching tabs makes React
    // unmount one and mount the other — a real removal from this <h1>, inside the column's own
    // subtree. Making that removal throw is the closest a test can get from outside to a component
    // blowing up mid-render.
    const heading = document.querySelector('[data-testid="session-title"]')
    if (heading === null) throw new Error('no session heading to sabotage')
    heading.removeChild = () => { throw new Error('DELIBERATE_RENDER_CRASH') }

    const tab = [...document.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')]
      .find((el) => el.textContent?.includes('Fix CSV export bug') === true)
    if (tab === undefined) throw new Error('no tab for Fix CSV export bug')
    await userEvent.click(page.elementLocator(tab))

    // The whole point: something to read, and a way forward — never an empty window.
    const crash = page.getByTestId('crash-pane')
    await expect.element(crash).toBeVisible()
    await expect.element(page.getByTestId('crash-message')).toHaveTextContent('DELIBERATE_RENDER_CRASH')
    await expect.element(page.getByTestId('crash-reload')).toBeVisible()

    // The stack is kept, folded away, so a bug report can carry more than the one-line message.
    const summary = crash.element().querySelector('summary')
    if (summary === null) throw new Error('no <summary> in the crash pane')
    await expect.element(page.elementLocator(summary)).toBeVisible()
  })
})
