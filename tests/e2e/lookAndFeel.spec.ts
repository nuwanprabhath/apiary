import { test, expect, type Locator } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * The floating-panel look: the sidebar, each editor pane and its shell are rounded cards on the
 * window background, a gap apart, and every gap is its divider's resize target with a pill-shaped
 * handle in it — the VS Code arrangement the user asked for.
 *
 * Every other test that once lived here moved down to tests/component/lookAndFeel.test.tsx, which
 * exercises the same geometry and CSS against the fake. This one test stays end-to-end because it
 * reads Electron's own `cursor-changed` event — proof the OS pointer actually changes shape, which
 * only a real window can produce.
 */
let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})

test.afterEach(async () => { await h.close() })

const box = async (l: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await l.boundingBox()
  if (b === null) throw new Error('not rendered')
  return b
}

/** The cursor the pointer shows at (x, y): what a user sees before they press. */
const cursorAt = (l: Locator, x: number, y: number): Promise<string> =>
  l.page().evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py)
    return el === null ? 'none' : getComputedStyle(el).cursor
  }, [x, y] as const)

test('each grab handle shows the resize cursor across a generous strip, and is drawn as grip dots', async () => {
  await h.page.getByTestId('session-tab-split').click()
  const probes: Array<[string, 'col' | 'row']> = [
    ['sidebar-resizer', 'col'], ['column-resizer', 'col'], ['bottom-resizer', 'row'],
  ]
  for (const [id, axis] of probes) {
    const handle = h.page.getByTestId(id).first()
    const r = await box(handle)
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    // Five pixels either side of the gap's centre line — VS Code's sash is about this wide, and a
    // 6px target is one people miss and then drag the neighbouring panel's contents instead.
    for (const d of [-5, 0, 5]) {
      const [x, y] = axis === 'col' ? [cx + d, cy] : [cx, cy + d]
      expect(await cursorAt(handle, x, y), `${id} at ${String(d)}px`).toBe(axis === 'col' ? 'col-resize' : 'row-resize')
    }
    const grip = await handle.evaluate((el) => getComputedStyle(el, '::after').backgroundImage)
    expect(grip, id).toContain('radial-gradient')
  }

  // And the cursor Chromium actually asks the OS for — the CSS value alone is not proof the pointer
  // changes shape.
  await h.app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as unknown as { cursors: string[] }
    g.cursors = []
    BrowserWindow.getAllWindows()[0].webContents.on('cursor-changed', (_e, type) => { g.cursors.push(type) })
  })
  for (const [id, axis] of probes) {
    const r = await box(h.page.getByTestId(id).first())
    const [x, y] = axis === 'col' ? [r.x + r.width / 2 + 5, r.y + r.height / 2] : [r.x + r.width / 2, r.y + r.height / 2 + 5]
    await h.page.mouse.move(x + 60, y + 60)
    await h.page.mouse.move(x, y, { steps: 4 })
    await expect.poll(() => h.app.evaluate(() => (globalThis as unknown as { cursors: string[] }).cursors.at(-1)), { message: id })
      .toBe(axis === 'col' ? 'col-resize' : 'row-resize')
  }

  // While dragging, the cursor stays a resize cursor even when the pointer runs ahead of the gap.
  const bottom = await box(h.page.getByTestId('bottom-resizer'))
  await h.page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(bottom.x + bottom.width / 2, bottom.y - 80, { steps: 3 })
  expect(await cursorAt(h.page.getByTestId('bottom-resizer'), bottom.x + 40, bottom.y - 200)).toBe('row-resize')
  await h.page.mouse.up()
})
