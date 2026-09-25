import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import type { FakeApiary } from './fakeApiary'
import { sidebarSession, clickRowAction, sessionRow, box, until } from './helpers'

/**
 * Notes on a session: the context a title has no room for — what was being chased, which ticket or
 * merge request it belongs to — written from the row, shown when hovering it, and searchable.
 */

/** The whole row for a session — a note mark and the hover card sit outside the title's own row. */
async function rowWrap(title: string): Promise<HTMLElement> {
  const row = await sessionRow(title)
  const wrap = row.closest<HTMLElement>('.session-row-wrap')
  if (wrap === null) throw new Error(`no row wrap for "${title}"`)
  return wrap
}

/**
 * Writes a note on a session through the row's note button.
 *
 * The real main process re-sends `treeChanged` once a note is saved (see `ipc.ts`'s
 * `apiary:set-session-note` handler), which is what makes the sidebar re-fetch the tree and pick
 * up the new note — `setSessionNote` on the fake only updates its own state, so this fires the
 * same event by hand rather than editing fakeApiary.ts.
 */
async function writeNote(fake: FakeApiary, title: string, note: string): Promise<void> {
  await clickRowAction(title, 'note-session-button')
  await expect.element(page.getByTestId('note-dialog')).toBeVisible()
  await userEvent.fill(page.getByTestId('note-input'), note)
  await userEvent.click(page.getByTestId('note-save'))
  fake.emit('treeChanged')
  await until(() => page.getByTestId('note-dialog').elements().length === 0)
}

/** Hovers a session and waits for its card, returning the card element. */
async function hoverCard(title: string): Promise<HTMLElement> {
  await userEvent.hover(sidebarSession(title))
  await until(() => page.getByTestId('session-hover-card').elements().length === 1)
  return document.querySelector('[data-testid="session-hover-card"]') as HTMLElement
}

describe('session notes', () => {
  it('only one note icon is on a row at a time, not the mark and the button together', async () => {
    const { fake } = await renderApp()
    // Reported: hovering an annotated row showed two near-identical note glyphs side by side. The
    // mark says "there is a note", the button says "edit it" — but not legibly, at 12px, together.
    await writeNote(fake, 'Fix CSV export bug', 'something worth noting')
    const wrap = await rowWrap('Fix CSV export bug')
    await until(() => wrap.querySelector('[data-testid="session-note-mark"]') !== null)

    await userEvent.hover(wrap)
    await until(() => wrap.querySelector('[data-testid="note-session-button"]') !== null)
    const button = wrap.querySelector('[data-testid="note-session-button"]')!
    // Hidden by CSS the moment the row's buttons take over — still in the DOM, not gone.
    expect(getComputedStyle(wrap.querySelector('[data-testid="session-note-mark"]')!).display).toBe('none')

    // The button still shows a note exists, so hiding the mark loses nothing.
    expect(button.getAttribute('data-has-note')).toBe('true')
  })

  it('the note is what the hover card shows', async () => {
    const { fake } = await renderApp()
    await writeNote(fake, 'Fix CSV export bug', 'Nightly pipeline is flaky on dev/1.0.12')

    const card = await hoverCard('Fix CSV export bug')
    expect(card.querySelector('[data-testid="hover-card-note"]')?.textContent)
      .toBe('Nightly pipeline is flaky on dev/1.0.12')
  })

  it('reopening the note editor shows what is already there, rather than a blank box', async () => {
    const { fake } = await renderApp()
    await writeNote(fake, 'Fix CSV export bug', 'first thoughts')

    await clickRowAction('Fix CSV export bug', 'note-session-button')
    await expect.element(page.getByTestId('note-input')).toHaveValue('first thoughts')

    await userEvent.fill(page.getByTestId('note-input'), 'first thoughts, then a second look')
    await userEvent.click(page.getByTestId('note-save'))
    fake.emit('treeChanged')

    const card = await hoverCard('Fix CSV export bug')
    expect(card.querySelector('[data-testid="hover-card-note"]')?.textContent).toContain('second look')
  })

  it('a note can be removed, and the row stops advertising one', async () => {
    const { fake } = await renderApp()
    await writeNote(fake, 'Fix CSV export bug', 'no longer relevant')

    await clickRowAction('Fix CSV export bug', 'note-session-button')
    await userEvent.click(page.getByTestId('note-remove'))
    fake.emit('treeChanged')

    const wrap = await rowWrap('Fix CSV export bug')
    await until(() => wrap.querySelector('[data-testid="session-note-mark"]') === null)
    expect(wrap.querySelector('[data-testid="session-note-mark"]')).toBeNull()
  })

  it('cancelling leaves the note as it was', async () => {
    const { fake } = await renderApp()
    await writeNote(fake, 'Fix CSV export bug', 'the real note')

    await clickRowAction('Fix CSV export bug', 'note-session-button')
    await userEvent.fill(page.getByTestId('note-input'), 'a change that should not stick')
    await userEvent.click(page.getByTestId('note-cancel'))

    const card = await hoverCard('Fix CSV export bug')
    expect(card.querySelector('[data-testid="hover-card-note"]')?.textContent).toBe('the real note')
  })

  it('the hover card covers no session in the list, neither beside nor below its row', async () => {
    // Two reports, one rule. Placed beside the row it once covered the sessions either side; moved
    // below, it covered the next several — the rows you read and move to next, so the next one
    // could not even be hovered. Both are "the card is on top of the list". It now sits out past
    // the sidebar's edge, which is checked here directly: against every session row on screen.
    await renderApp()
    await hoverCard('Fix CSV export bug')
    const card = page.getByTestId('session-hover-card')

    const cardBox = box(card)
    const sidebarBox = box(page.getByTestId('sidebar'))
    expect(cardBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1)

    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="session-item"]')) {
      const r = el.getBoundingClientRect()
      const overlaps = cardBox.x < r.x + r.width && cardBox.x + cardBox.width > r.x
        && cardBox.y < r.y + r.height && cardBox.y + cardBox.height > r.y
      expect(overlaps, `card covers a session row at y=${String(r.y)}`).toBe(false)
    }
    // Still top-aligned with the row it describes, so which row it belongs to is not in doubt.
    const rowBox = (await sessionRow('Fix CSV export bug')).getBoundingClientRect()
    expect(Math.abs(cardBox.y - rowBox.y)).toBeLessThan(4)
  })
})
