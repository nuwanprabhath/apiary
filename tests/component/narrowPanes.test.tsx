import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** Split the pane in a narrow window: nothing of a pane sticks out of it, and Active lists once. */
describe('a split pane in a narrow window', () => {
  it('keeps the header, tab strip and composer inside their pane, and Active has one row', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Worktree session'))
    await until(() => document.querySelector('[data-testid="transcript"]') !== null)
    await userEvent.click(page.getByTestId('shell-toggle'))
    await userEvent.click(page.getByTestId('session-tab-split').first())
    await until(() => document.querySelectorAll('.session-column').length >= 2)
    await page.viewport(800, 800)
    await until(() => window.innerWidth === 800)

    const outside: string[] = []
    for (const column of document.querySelectorAll('.session-column')) {
      const pane = column.getBoundingClientRect()
      const parts = column.querySelectorAll(
        '.session-header, .session-header > *, .resume-bar button, .session-tab-bar, .session-tab-split, .composer, .composer-actions > *',
      )
      for (const part of parts) {
        const box = part.getBoundingClientRect()
        if (box.width === 0) continue
        outside.push(...(box.left < pane.left - 1 || box.right > pane.right + 1 ? [String(part.className)] : []))
      }
    }
    expect(outside).toEqual([])
    // The hint is whole or not shown at all: its text lies either wholly inside the hint's visible
    // line, or wholly below it (dropped to the clipped second line).
    const cutHints = [...document.querySelectorAll<HTMLElement>('[data-testid="composer-hint"]')].filter((hint) => {
      const line = hint.getBoundingClientRect()
      const text = hint.querySelector('.composer-hint-text')?.getBoundingClientRect()
      if (text === undefined || line.width === 0) return false
      const whole = text.left >= line.left - 1 && text.right <= line.right + 1 && text.bottom <= line.bottom + 1
      const hidden = text.top >= line.bottom - 1
      return !whole && !hidden
    })
    expect(cutHints).toHaveLength(0)

    await until(() => document.querySelector('[data-testid="active-tab-row"]') !== null)
    expect(document.querySelectorAll('[data-testid="active-tab-row"]')).toHaveLength(1)
  })
})

/** Send is the primary action: at the footer's right edge on the first row, whatever else hides. */
describe('the composer footer in a split pane', () => {
  const cases = [
    { name: 'plain', title: 'Worktree session', settings: undefined, widths: [760, 900] },
    { name: 'chat', title: 'Fix CSV export bug', settings: { transcriptChat: true }, widths: [900, 760] },
  ] as const
  for (const c of cases) {
    it(`keeps Send at the right on the first row (${c.name})`, async () => {
      await renderApp(c.settings === undefined ? undefined : { settings: c.settings })
      await userEvent.click(sidebarSession(c.title))
      await until(() => document.querySelector('[data-testid="transcript"]') !== null)
      await userEvent.click(page.getByTestId('session-tab-split').first())
      await until(() => document.querySelectorAll('.session-column').length >= 2)
      for (const width of c.widths) {
        await page.viewport(width, 800)
        await until(() => window.innerWidth === width)
        for (const footer of document.querySelectorAll('.composer-actions')) {
          const send = footer.querySelector('[data-testid="composer-send"]')
          if (send === null) continue
          const f = footer.getBoundingClientRect()
          const s = send.getBoundingClientRect()
          const first = [...footer.children].find((el) => el.getBoundingClientRect().width > 0)!
          await until(() => f.right - send.getBoundingClientRect().right <= 12)
          expect(f.right - s.right).toBeLessThanOrEqual(12)
          expect(Math.abs(s.top - first.getBoundingClientRect().top)).toBeLessThanOrEqual(8)
        }
      }
    })
  }
})
