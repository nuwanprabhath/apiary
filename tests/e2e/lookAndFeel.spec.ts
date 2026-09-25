import { test, expect, type Locator } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * The floating-panel look: the sidebar, each editor pane and its shell are rounded cards on the
 * window background, a gap apart, and every gap is its divider's resize target with a pill-shaped
 * handle in it — the VS Code arrangement the user asked for.
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

const radius = (l: Locator): Promise<number> =>
  l.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))
const box = async (l: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await l.boundingBox()
  if (b === null) throw new Error('not rendered')
  return b
}

test('the sidebar, the session and its shell are rounded cards a gap apart', async () => {
  const sidebar = h.page.getByTestId('sidebar')
  const session = h.page.getByTestId('session-card')
  const shell = h.page.getByTestId('shell-card')
  for (const card of [sidebar, session, shell]) expect(await radius(card)).toBeGreaterThanOrEqual(6)

  const [s, c, sh] = [await box(sidebar), await box(session), await box(shell)]
  expect(c.x - (s.x + s.width)).toBeGreaterThanOrEqual(4)
  expect(sh.y - (c.y + c.height)).toBeGreaterThanOrEqual(4)
  // No divider lines: the gap does that job now.
  expect(await sidebar.evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe('0px')

  await h.page.screenshot({ path: '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/look-floating.png' })
})

test('every gap has a grab handle that answers the pointer, and dragging it resizes', async () => {
  const resizer = h.page.getByTestId('sidebar-resizer')
  const pill = (l: Locator): Promise<{ opacity: string; height: string }> =>
    l.evaluate((el) => { const st = getComputedStyle(el, '::after'); return { opacity: st.opacity, height: st.height } })
  expect((await pill(resizer)).height).toBe('18px')
  await resizer.hover()
  await expect.poll(async () => (await pill(resizer)).opacity).toBe('1')

  const before = (await box(h.page.getByTestId('sidebar'))).width
  const r = await box(resizer)
  await h.page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(r.x + r.width / 2 + 60, r.y + r.height / 2, { steps: 5 })
  await h.page.mouse.up()
  expect((await box(h.page.getByTestId('sidebar'))).width).toBeGreaterThan(before + 40)

  const bottom = h.page.getByTestId('bottom-resizer')
  expect((await pill(bottom)).height).toBe('4px')
  await bottom.hover()
  await expect.poll(async () => (await pill(bottom)).opacity).toBe('1')

  await h.page.getByTestId('session-tab-split').click()
  const column = h.page.getByTestId('column-resizer').first()
  await column.hover()
  await expect.poll(async () => (await pill(column)).opacity).toBe('1')
  await h.page.screenshot({ path: '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/look-split.png' })
})

test('a scrollbar shows while its list scrolls, and hides again when left alone', async () => {
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-themes').click()
  const pane = h.page.getByTestId('settings-pane')
  await h.page.mouse.move(5, 5)
  await h.page.screenshot({ path: '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/scroll-idle.png', clip: (await pane.boundingBox())! })
  await pane.evaluate((el) => { el.scrollTop = 120 })
  await expect(pane).toHaveAttribute('data-scrolling', '')
  await h.page.screenshot({ path: '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/scroll-active.png', clip: (await pane.boundingBox())! })
  await expect(pane).not.toHaveAttribute('data-scrolling', { timeout: 3000 })
})

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
  await h.page.screenshot({ path: '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/look-grips.png' })
})

test('every corner follows the theme: unchanged on the original look, rounder on a rounder theme', async () => {
  const px = (testId: string): Promise<number> => h.page.getByTestId(testId).first()
    .evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius))
  const token = (name: string): Promise<number> => h.page.evaluate((n) => {
    const probe = document.createElement('div')
    probe.style.width = `var(${n})`
    document.body.append(probe)
    const w = probe.getBoundingClientRect().width
    probe.remove()
    return w
  }, name)
  // The original look, exactly as before corners were derived from the panel radius.
  expect(await token('--radius-sm')).toBe(4)
  expect(await token('--radius-row')).toBe(5)
  expect(await token('--radius-lg')).toBe(10)
  expect(await px('shell-toggle')).toBe(6)

  await h.page.evaluate(() => window.apiary.themeApply('builtin:glass'))
  await expect(h.page.locator('html')).toHaveAttribute('data-material', 'glass')
  const panel = await radius(h.page.getByTestId('shell-card'))
  expect(panel).toBe(14)
  // The Hide shell button sits a few pixels inside the card's corner: it has to be about as
  // round as that corner minus the inset, not a fixed 6px that reads as square next to it.
  for (const id of ['shell-toggle', 'sidebar-refresh', 'session-tab']) {
    expect(await px(id), id).toBeGreaterThanOrEqual(panel * 0.6)
  }
  expect(await token('--radius-sm')).toBe(7)
  expect(await token('--radius-lg')).toBeCloseTo(17.5)
  await h.page.getByTestId('shell-toggle').hover()
  const card = (await h.page.getByTestId('shell-card').boundingBox())!
  await h.page.screenshot({ path: '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/radius-glass.png', clip: { x: card.x - 4, y: card.y - 4, width: 260, height: 60 } })
})
