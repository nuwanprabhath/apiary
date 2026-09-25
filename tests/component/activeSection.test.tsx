import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** The Active section's row-wrap for a title, once there is one. */
async function activeRowWrap(title: string): Promise<HTMLElement> {
  const find = (): HTMLElement | undefined => [...document.querySelectorAll<HTMLElement>('.active-row-wrap')]
    .find((el) => el.textContent?.includes(title) === true)
  await until(() => find() !== undefined)
  const el = find()
  if (el === undefined) throw new Error(`no Active row for "${title}"`)
  return el
}

describe('the Active section', () => {
  it('the status dot names its status for a screen reader, not only by colour', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    // A tab report reaches the sidebar asynchronously (App's effect calls `reportTabs`, which the
    // fake answers by emitting `activeTabsChanged`) — waited for directly, since `expect.element`'s
    // first (failing) poll on an element that does not exist yet trips a pretty-format recursion
    // bug in this environment when it tries to print the empty result.
    await until(() => document.querySelector('[data-testid="active-status-dot"]') !== null)
    const dot = page.getByTestId('active-section').getByTestId('active-status-dot')
    await expect.element(dot).toBeVisible()
    expect(dot.element().getAttribute('aria-label')).toMatch(/./)
  })

  it('hovering the Active header explains what each status dot means', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => document.querySelector('[data-testid="active-section"]') !== null)
    await expect.element(page.getByTestId('active-section')).toBeVisible()

    await expect.element(page.getByTestId('activity-legend')).not.toBeInTheDocument()
    await userEvent.hover(page.getByTestId('active-header'))
    await until(() => document.querySelector('[data-testid="activity-legend"]') !== null)

    const legend = page.getByTestId('activity-legend')
    await expect.element(legend).toBeVisible()
    // Every status the dots can take is named, or the legend is a legend with a hole in it.
    for (const name of ['Running', 'Waiting for input', 'Idle', 'Stopped']) {
      await expect.element(legend).toHaveTextContent(name)
    }
    // Drawn with the real dots, so the motion in the legend is the motion on the rows.
    expect(legend.element().querySelectorAll('.status-dot')).toHaveLength(4)
  })

  it('an Active row edits the session\'s note, like a row in the tree', async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const row = await activeRowWrap('Fix CSV export bug')
    await userEvent.hover(row)
    const note = row.querySelector<HTMLElement>('[data-testid="active-note-button"]')
    if (note === null) throw new Error('no note button on the Active row')
    await expect.element(page.elementLocator(note)).toBeVisible()
    // Hover reveals it in the space the window number otherwise takes, as a tree row's age does.
    const windowNumber = row.querySelector<HTMLElement>('.active-window-number')
    if (windowNumber === null) throw new Error('no .active-window-number on the Active row')
    await expect.element(page.elementLocator(windowNumber)).not.toBeVisible()

    await userEvent.click(note)
    await until(() => document.querySelector('[data-testid="note-dialog"]') !== null)
    await userEvent.fill(page.getByTestId('note-input'), 'check with Mark first')
    await userEvent.click(page.getByTestId('note-save'))
    // The main process pushes `treeChanged` once a note write reaches the store (see
    // main/ipc.ts's `setSessionNote` handler) — the fake's own `setSessionNote` has no store of
    // its own to push a signal from, so the test raises the same event main would.
    fake.emit('treeChanged')
    await until(() => document.querySelector('[data-testid="note-dialog"]') === null)

    // Saved on the session itself, so the tree row carries it too.
    const updatedRow = await activeRowWrap('Fix CSV export bug')
    const updatedNote = updatedRow.querySelector<HTMLElement>('[data-testid="active-note-button"]')
    if (updatedNote === null) throw new Error('no note button after saving')
    await expect.element(page.elementLocator(updatedNote)).toHaveAttribute('data-has-note', 'true')
    // The tree's row, specifically: the Active row carries the same title and has no hover card.
    const treeRow = [...document.querySelectorAll<HTMLElement>('.tree [data-testid="session-item"]')]
      .find((el) => el.textContent?.includes('Fix CSV export bug') === true)
    if (treeRow === undefined) throw new Error('no tree row for the session')
    await userEvent.hover(page.elementLocator(treeRow))
    await until(() => document.querySelector('[data-testid="hover-card-note"]') !== null)
    await expect.element(page.getByTestId('hover-card-note')).toHaveTextContent('check with Mark first')
  })
})
