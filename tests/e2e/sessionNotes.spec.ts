import { test, expect } from '@playwright/test'
import {
  launchApiary, importAll, sidebarSession, clickRowAction, relaunchApiary, type Harness,
} from './helpers'

/**
 * Notes on a session: the context a title has no room for — what was being chased, which ticket or
 * merge request it belongs to — written from the row, shown when hovering it, and searchable.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

/**
 * The whole row for a session — `sidebarSession` resolves to the title text inside it, which is a
 * sibling of the note mark rather than its parent.
 */
function row(title: string) {
  return h.page.locator('.session-row-wrap', { has: h.page.getByText(title, { exact: true }) })
}

/** Writes a note on a session through the row's note button. */
async function writeNote(title: string, note: string): Promise<void> {
  await clickRowAction(sidebarSession(h.page, title), 'note-session-button')
  await expect(h.page.getByTestId('note-dialog')).toBeVisible()
  await h.page.getByTestId('note-input').fill(note)
  await h.page.getByTestId('note-save').click()
  await expect(h.page.getByTestId('note-dialog')).toHaveCount(0)
}

test('a note can be written on a session from its row, and survives a restart', async () => {
  await writeNote('Fix CSV export bug', 'Debugging the nightly pipeline, MR !1257 open')

  // The row itself says there is one, so annotated sessions can be picked out without hovering.
  await expect(row('Fix CSV export bug').getByTestId('session-note-mark')).toBeVisible()

  await relaunchApiary(h)
  await expect(row('Fix CSV export bug').getByTestId('session-note-mark')).toBeVisible()
})

test('only one note icon is on a row at a time, not the mark and the button together', async () => {
  // Reported: hovering an annotated row showed two near-identical note glyphs side by side. The
  // mark says "there is a note", the button says "edit it" — but not legibly, at 12px, together.
  await writeNote('Fix CSV export bug', 'something worth noting')
  const target = row('Fix CSV export bug')
  await expect(target.getByTestId('session-note-mark')).toBeVisible()

  await target.hover()
  await expect(target.getByTestId('note-session-button')).toBeVisible()
  await expect(target.getByTestId('session-note-mark')).toBeHidden()

  // The button still shows a note exists, so hiding the mark loses nothing.
  await expect(target.getByTestId('note-session-button')).toHaveAttribute('data-has-note', 'true')
})

test('the note is what the hover card shows', async () => {
  await writeNote('Fix CSV export bug', 'Nightly pipeline is flaky on dev/1.0.12')

  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('hover-card-note')).toHaveText('Nightly pipeline is flaky on dev/1.0.12')
})

test('reopening the note editor shows what is already there, rather than a blank box', async () => {
  await writeNote('Fix CSV export bug', 'first thoughts')

  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'note-session-button')
  await expect(h.page.getByTestId('note-input')).toHaveValue('first thoughts')

  await h.page.getByTestId('note-input').fill('first thoughts, then a second look')
  await h.page.getByTestId('note-save').click()

  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  await expect(h.page.getByTestId('hover-card-note')).toContainText('second look')
})

test('a note can be removed, and the row stops advertising one', async () => {
  await writeNote('Fix CSV export bug', 'no longer relevant')

  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'note-session-button')
  await h.page.getByTestId('note-remove').click()

  await expect(row('Fix CSV export bug').getByTestId('session-note-mark')).toHaveCount(0)
})

test('cancelling leaves the note as it was', async () => {
  await writeNote('Fix CSV export bug', 'the real note')

  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'note-session-button')
  await h.page.getByTestId('note-input').fill('a change that should not stick')
  await h.page.getByTestId('note-cancel').click()

  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  await expect(h.page.getByTestId('hover-card-note')).toHaveText('the real note')
})

test('searching finds a session by its note, including by an MR number', async () => {
  // The case this feature exists for: months later, all you remember is the merge request.
  await writeNote('Fix CSV export bug', 'nightly pipeline failure, MR !1257 against dev/1.0.12')

  const search = h.page.getByTestId('search-input')
  for (const query of ['nightly', '!1257', '1257']) {
    await search.fill(query)
    await expect(h.page.getByTestId('session-item')).toHaveCount(1)
    await expect(h.page.getByTestId('session-item').first()).toContainText('Fix CSV export bug')
  }

  // And a word in nobody's note still finds nothing, so the match is the note and not everything.
  await search.fill('zzzznotanote')
  await expect(h.page.getByTestId('session-item')).toHaveCount(0)
})

test('turning note search off stops notes matching, but keeps the notes themselves', async () => {
  await writeNote('Fix CSV export bug', 'nightly pipeline failure')

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-search').click()
  await h.page.getByTestId('setting-search-session-notes').uncheck()
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)

  await h.page.getByTestId('search-input').fill('nightly')
  await expect(h.page.getByTestId('session-item')).toHaveCount(0)

  // The note is the user's writing, not an index: it is still on the session.
  await h.page.getByTestId('search-clear').click()
  await sidebarSession(h.page, 'Fix CSV export bug').hover()
  await expect(h.page.getByTestId('hover-card-note')).toHaveText('nightly pipeline failure')
})

test('the hover card covers no session in the list, neither beside nor below its row', async () => {
  // Two reports, one rule. Placed beside the row it once covered the sessions either side; moved
  // below, it covered the next several — the rows you read and move to next, so the next one
  // could not even be hovered. Both are "the card is on top of the list". It now sits out past
  // the sidebar's edge, which is checked here directly: against every session row on screen.
  const target = sidebarSession(h.page, 'Fix CSV export bug')
  await target.hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()

  const cardBox = (await card.boundingBox())!
  const sidebarBox = (await h.page.getByTestId('sidebar').boundingBox())!
  expect(cardBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1)

  for (const box of await h.page.getByTestId('session-item').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))) {
    const overlaps = cardBox.x < box.x + box.w && cardBox.x + cardBox.width > box.x
      && cardBox.y < box.y + box.h && cardBox.y + cardBox.height > box.y
    expect(overlaps, `card covers a session row at y=${String(box.y)}`).toBe(false)
  }
  // Still top-aligned with the row it describes, so which row it belongs to is not in doubt.
  const rowBox = (await row('Fix CSV export bug').boundingBox())!
  expect(Math.abs(cardBox.y - rowBox.y)).toBeLessThan(4)
})

test('the branch can be copied from the hover card, which stays up while reaching for it', async () => {
  await sidebarSession(h.page, 'Worktree session').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()

  // Moving onto the card crosses a gap: the card has to survive the trip, or the button it exists
  // to offer can never be clicked.
  const copy = card.getByTestId('hover-card-copy-branch')
  await copy.hover()
  await expect(card).toBeVisible()
  await copy.click()

  // Electron's clipboard, not the page's: the copy goes through the main process.
  expect(await h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('feature/wt')
})
