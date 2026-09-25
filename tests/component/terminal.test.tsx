import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, box, mouse } from './helpers'
import { FIXTURE_SESSIONS } from './fakeApiary'

describe('the terminal panes', () => {
  it('disables resume when the working directory is gone', async () => {
    await renderApp({
      sessions: FIXTURE_SESSIONS.map((s) => (
        s.title === 'Fix CSV export bug' ? { ...s, cwdExists: false } : s
      )),
    })
    await userEvent.click(sidebarSession('Fix CSV export bug'))

    await expect.element(page.getByTestId('resume-button')).toBeDisabled()
    await expect.element(page.getByTestId('resume-button')).toHaveAttribute('data-cwd-exists', 'false')
  })

  // Regression test: dragging the resizer is a mousedown-then-mousemove-over-page-content
  // sequence, which — with nothing to stop it — the browser treats exactly like a click-drag text
  // selection, highlighting whatever surrounding text (the session title, "Hide shell", etc.) the
  // cursor passes over during the drag. `preventDefault()` on mousedown plus a `user-select: none`
  // class for the duration of the drag closes this off.
  it('dragging the bottom-pane resizer does not select surrounding page text', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()

    const resizer = page.getByTestId('bottom-resizer')
    const b = box(resizer)
    const startX = b.x + b.width / 2
    const startY = b.y + b.height / 2

    await mouse.move(startX, startY)
    await mouse.down()
    // Drag up and across, passing directly over the session title text above the resizer.
    await mouse.move(startX - 100, startY - 150, 15)
    await mouse.move(startX, startY - 40, 15)

    const selectedText = window.getSelection()?.toString() ?? ''
    await mouse.up()

    expect(selectedText).toBe('')
  })
})
