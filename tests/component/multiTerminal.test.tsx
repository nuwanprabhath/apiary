import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** Where a click lands on a terminal's name: its start, clear of the buttons that float over the
 *  end of the row on hover. */
const NAME_START = { position: { x: 8, y: 8 } }

describe('multi-terminal', () => {
  async function open(): Promise<void> {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
  }

  it('renames a terminal tab', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-list-toggle'))
    await userEvent.dblClick(page.getByTestId('terminal-tab-label'), NAME_START)
    await userEvent.fill(page.getByTestId('terminal-tab-rename-input'), 'Build watcher')
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('terminal-tab-label')).toHaveTextContent('Build watcher')
  })

  it('F2 in a terminal renames that terminal, opening the list to do it in', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-add'))
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 2)
    // Hidden first, so the key is shown to bring the list back rather than relying on it being open.
    await userEvent.click(page.getByTestId('terminal-list-toggle'))
    await expect.element(page.getByTestId('terminal-list-panel')).not.toBeInTheDocument()

    await userEvent.click(page.getByTestId('terminal-shell'))
    await userEvent.keyboard('{F2}')
    const input = page.getByTestId('terminal-tab-rename-input')
    await expect.element(input).toHaveFocus()
    // The one in front is the second, just added — not simply the first in the list.
    await expect.element(input).toHaveValue('Terminal 2')
    await userEvent.fill(input, 'Logs')
    await userEvent.keyboard('{Enter}')
    const labels = page.getByTestId('terminal-tab-label').elements()
    expect(labels[labels.length - 1].textContent).toBe('Logs')
  })

  it('F2 on the terminal list renames the terminal in front', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-list-toggle'))
    ;(page.getByTestId('terminal-list-panel').element() as HTMLElement).focus()
    await userEvent.keyboard('{F2}')
    await expect.element(page.getByTestId('terminal-tab-rename-input')).toHaveValue('Terminal 1')
    await userEvent.keyboard('{Escape}')
    // Escaped, and not reopened when the list is hidden and shown again.
    await userEvent.click(page.getByTestId('terminal-list-toggle'))
    await userEvent.click(page.getByTestId('terminal-list-toggle'))
    await expect.element(page.getByTestId('terminal-tab-rename-input')).not.toBeInTheDocument()
  })

  it('a rename button and a delete button both appear on hovering a terminal row', async () => {
    // With several terminals open there was previously no discoverable way to manage them beyond
    // double-clicking the label (to rename) or a trash icon easy to miss — both actions now have a
    // dedicated, hover-revealed button.
    await open()
    await userEvent.click(page.getByTestId('terminal-add'))
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 2)

    // An element, not a locator: renaming the row changes its accessible name, which is what a
    // locator re-resolves by — the same trap `helpers.ts`'s `sessionRow` avoids.
    const row = page.getByTestId('terminal-tab-row').elements()[0]
    const within = (testId: string): HTMLElement => row.querySelector(`[data-testid="${testId}"]`) as HTMLElement
    await expect.element(within('terminal-tab-rename')).not.toBeVisible()
    await expect.element(within('terminal-tab-delete')).not.toBeVisible()

    await userEvent.hover(row)
    await expect.element(within('terminal-tab-rename')).toBeVisible()
    await expect.element(within('terminal-tab-delete')).toBeVisible()

    await userEvent.click(within('terminal-tab-rename'))
    await userEvent.fill(page.getByTestId('terminal-tab-rename-input'), 'Dev server')
    await userEvent.keyboard('{Enter}')
    await expect.element(within('terminal-tab-label')).toHaveTextContent('Dev server')

    await userEvent.hover(row)
    await userEvent.click(within('terminal-tab-delete'))
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 1)
  })

  it('deletes a terminal tab, switching to a remaining one', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-add'))
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 2)

    const rows = page.getByTestId('terminal-tab-row').all()
    const last = rows[rows.length - 1]
    await userEvent.hover(last)
    await userEvent.click(last.getByTestId('terminal-tab-delete'))
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 1)
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
  })

  it('deleting the last terminal collapses the pane back to Show shell', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-list-toggle'))
    const row = page.getByTestId('terminal-tab-row')
    await userEvent.hover(row)
    await userEvent.click(row.getByTestId('terminal-tab-delete'))
    await expect.element(page.getByTestId('shell-toggle')).toHaveTextContent('Show shell')
    await expect.element(page.getByTestId('terminal-shell')).not.toBeInTheDocument()
  })

  it('the "+" button reveals the terminal list, so a new terminal is visibly a new terminal', async () => {
    // Without this the list stays shut and the new terminal is indistinguishable from the one
    // already on screen — the click reads as having done nothing at all.
    await open()
    await expect.element(page.getByTestId('terminal-list-panel')).not.toBeInTheDocument()
    await userEvent.click(page.getByTestId('terminal-add'))
    await expect.element(page.getByTestId('terminal-list-panel')).toBeVisible()
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 2)
  })

  it('the terminal never renders taller than the space it has, at any pane size', async () => {
    // The recurring "bottom of the terminal is cut off". `.terminal-tab-view` was a plain block, so
    // `.terminal-host`'s `flex: 1` was inert and its height fell back to `auto` — i.e. to xterm's own
    // content. FitAddon measures that host to decide how many rows fit, so the measurement was
    // self-referential: it reported the size the terminal already was rather than the size available
    // to it, the row count never came down, and the overflow was clipped by the pane. Measured at the
    // time: a 352px host inside a 167px row, its last ~11 rows rendered below the window.
    await open()
    const geometry = (): { host: number; row: number; overshoot: number } => {
      const host = document.querySelector('[data-testid="terminal-shell"]') as HTMLElement
      const row = document.querySelector('.terminal-panel-row') as HTMLElement
      const h1 = host.getBoundingClientRect()
      const r1 = row.getBoundingClientRect()
      return {
        host: Math.round(h1.height),
        row: Math.round(r1.height),
        overshoot: Math.round(h1.bottom - r1.bottom),
      }
    }

    const initial = geometry()
    expect(initial.host).toBeLessThanOrEqual(initial.row + 1)
    expect(initial.overshoot).toBeLessThanOrEqual(1)

    // And it keeps up when the space it has shrinks, rather than holding on to its old height.
    const pane = document.querySelector('.bottom-pane') as HTMLElement
    pane.style.height = '120px'
    await until(() => geometry().row < initial.row)

    const shrunk = geometry()
    expect(shrunk.row).toBeLessThan(initial.row)
    expect(shrunk.host).toBeLessThanOrEqual(shrunk.row + 1)
    expect(shrunk.overshoot).toBeLessThanOrEqual(1)
  })

  it('a long branch name ellipsizes instead of growing the toolbar into the terminal', async () => {
    await open()
    const toolbarHeight = (): number =>
      Math.round(document.querySelector('.toolbar')!.getBoundingClientRect().height)
    const before = toolbarHeight()

    // Three columns makes each one narrow — the case where the branch label used to wrap over three
    // lines, and every line it grew was a line taken from the terminal below it.
    await userEvent.click(page.getByTestId('session-tab-split'))
    await userEvent.click(page.getByTestId('session-tab-split').all()[0])
    await until(() => page.getByTestId('session-column').elements().length === 3)
    await until(() => toolbarHeight() === before)

    expect(toolbarHeight()).toBe(before)
  })

  it('arrowing through the terminal list moves the selection without boxing the row you clicked', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-add'))
    await userEvent.click(page.getByTestId('terminal-add'))
    await until(() => page.getByTestId('terminal-tab-row').elements().length === 3)
    const rows = page.getByTestId('terminal-tab-row')

    await userEvent.click(rows.all()[1].getByTestId('terminal-tab-label'), NAME_START)
    await expect.element(rows.all()[1]).toHaveAttribute('data-active', 'true')

    await userEvent.keyboard('{ArrowUp}')
    await expect.element(rows.all()[0]).toHaveAttribute('data-active', 'true')
    await expect.element(rows.all()[0]).toHaveAttribute('data-keyboard-focused', 'true')
    await expect.element(rows.all()[1]).toHaveAttribute('data-keyboard-focused', 'false')

    // The reported bug: DOM focus stayed on the button of the row that was clicked, so pressing a
    // key made Chromium draw its own focus ring around it — a box around a row that the selection
    // had already left, and one that reads as the rename field a row turns into.
    expect(document.activeElement?.className ?? '').toContain('terminal-list-panel')

    await userEvent.keyboard('{ArrowDown}')
    await expect.element(rows.all()[1]).toHaveAttribute('data-active', 'true')
  })

  it('the terminal in front is a lifted chip, not a bar down its edge', async () => {
    await open()
    await userEvent.click(page.getByTestId('terminal-add'))
    const rows = page.getByTestId('terminal-tab-row')
    await userEvent.click(rows.all()[1].getByTestId('terminal-tab-label'), NAME_START)
    await userEvent.keyboard('{ArrowUp}')
    await expect.element(rows.all()[0]).toHaveAttribute('data-active', 'true')
    // A ring and a soft drop shadow, as on the active tab (polled: it eases in) — and no inset bar.
    await until(() => getComputedStyle(rows.all()[0].element()).boxShadow.includes('0px 1px 3px'))
    const row = rows.all()[0].element()
    const shadow = getComputedStyle(row).boxShadow
    const labelShadow = getComputedStyle(row.querySelector('.terminal-tab-label')!).boxShadow
    expect(shadow).not.toContain('inset')
    expect(labelShadow).toBe('none')
  })
})
