import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, relaunchApiary, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

const cssVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

async function openThemes(page: Page): Promise<void> {
  // To every window: which one is "first" is not the test's business, and only `page` is used.
  await h.app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('apiary:open-settings-dialog')
  })
  await page.getByTestId('settings-nav-themes').click()
  await expect(page.getByTestId('themes-section')).toBeVisible()
}
const card = (page: Page, id: string) => page.locator(`[data-testid="theme-card"][data-theme-id="${id}"]`)
const closeSettings = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape')
  if (await page.getByTestId('settings-dialog').count() > 0) await page.getByRole('button', { name: /cancel|close/i }).first().click()
}

test('a built-in theme recolours the app and a live terminal, and survives a relaunch', { tag: '@smoke' }, async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  // The host paints the terminal's colour (xterm's own background is transparent — see styles.css).
  const termBg = (): Promise<string> => h.page.getByTestId('terminal-shell')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const before = await termBg()

  await openThemes(h.page)
  await card(h.page, 'builtin:matrix').click()
  await expect(card(h.page, 'builtin:matrix')).toHaveAttribute('data-active', 'true')
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#22ff5aff')
  expect(await h.page.evaluate(() => document.documentElement.dataset.monoFont)).toBe('share-tech-mono')
  await closeSettings(h.page)
  await expect.poll(termBg).not.toBe(before)
  // The terminal keeps working in its new font: what is typed still shows.
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo THEMED_$((6*7))\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('THEMED_42', { timeout: 10000 })
  await expect(h.page.getByTestId('theme-effects-back')).toBeVisible()

  await relaunchApiary(h)
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#22ff5aff')
})

test('Reset to original, and View → Reset Theme, both bring back the original look', async () => {
  const original = await cssVar(h.page, '--accent')
  await openThemes(h.page)
  await card(h.page, 'builtin:neon').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#ff2a6dff')
  await h.page.getByTestId('theme-reset').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe(original)

  await card(h.page, 'builtin:paper').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#a8471fff')
  await h.app.evaluate(({ Menu }) => { Menu.getApplicationMenu()?.getMenuItemById('reset-theme')?.click() })
  await expect.poll(() => cssVar(h.page, '--accent')).toBe(original)
  await expect(card(h.page, 'original')).toHaveAttribute('data-active', 'true')
})

test('every window switches theme together', async () => {
  const opened = h.app.waitForEvent('window')
  await h.app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find((i) => i.label === 'File')
    file?.submenu?.items.find((i) => /new window/i.test(i.label))?.click()
  })
  const second = await opened
  await second.waitForLoadState('domcontentloaded')
  await openThemes(h.page)
  await card(h.page, 'builtin:neon').click()
  await expect.poll(() => cssVar(second, '--accent')).toBe('#ff2a6dff')
})

test('--safe-theme starts in the original look without forgetting the chosen theme', async () => {
  const original = await cssVar(h.page, '--accent')
  await openThemes(h.page)
  await card(h.page, 'builtin:neon').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#ff2a6dff')

  await relaunchApiary(h, { APIARY_SAFE_THEME: '1' })
  expect(await cssVar(h.page, '--accent')).toBe(original)
  await openThemes(h.page)
  await expect(h.page.getByTestId('theme-safe-mode')).toBeVisible()
  await expect(card(h.page, 'builtin:neon')).toHaveAttribute('data-active', 'true')
})

test('a hostile themes.json is applied only as its safe parts', async () => {
  const original = await cssVar(h.page, '--bg')
  mkdirSync(join(h.home, 'userdata'), { recursive: true })
  writeFileSync(join(h.home, 'userdata', 'themes.json'), JSON.stringify({
    version: 1, activeThemeId: 'x',
    themes: [{ id: 'x', name: 'Hostile', prompt: null, createdAt: 1, spec: {
      palette: { bg: 'url(https://example.com/a.png)', accent: '#123456; display:none', info: '#00ffcc' },
      font: { ui: 'Comic Sans', mono: 'vt323' },
      effects: [{ kind: 'fireworks' }, { kind: 'noise', intensity: 50 }],
    } }],
  }))
  await relaunchApiary(h)
  expect(await cssVar(h.page, '--bg')).toBe(original)
  expect(await cssVar(h.page, '--info')).toBe('#00ffccff')
  expect(await h.page.evaluate(() => document.documentElement.dataset.uiFont)).toBe('system')
  await expect(h.page.getByTestId('sidebar')).toBeVisible()
})

test('a glass theme turns the panels into blurred panes, and menus inside them still open where clicked', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  await openThemes(h.page)
  await card(h.page, 'builtin:glass').click()
  await expect(card(h.page, 'builtin:glass')).toHaveAttribute('data-active', 'true')
  await closeSettings(h.page)

  await expect(h.page.locator('html')).toHaveAttribute('data-material', 'glass')
  const pane = (testId: string, pseudo: '::before' | '::after') => h.page.getByTestId(testId).evaluate(
    (el, p) => {
      const target = el.classList.contains('sidebar') ? el.parentElement! : el
      const st = getComputedStyle(target, p)
      return { filter: st.backdropFilter, shadow: st.boxShadow, bg: getComputedStyle(el).backgroundColor }
    }, pseudo)
  for (const id of ['sidebar', 'session-card', 'shell-card']) {
    const before = await pane(id, '::before')
    // No live backdrop filter: it re-ran on every frame and made the app lag without GPU
    // compositing. The blur is in the back canvas instead (below).
    expect(before.filter, id).toBe('none')
    expect(before.bg, id).toBe('rgba(0, 0, 0, 0)')
    expect((await pane(id, '::after')).shadow, id).toContain('inset')
  }
  // The background behind the glass is drawn at a fraction of the window's resolution and scaled
  // up — that is the blur.
  const canvas = await h.page.getByTestId('theme-effects-back').evaluate((c) => ({ w: (c as HTMLCanvasElement).width, css: c.clientWidth }))
  expect(canvas.w).toBeLessThan(canvas.css / 4)
  const filters = await h.page.evaluate(() => [...document.querySelectorAll('*')]
    .filter((el) => getComputedStyle(el).backdropFilter !== 'none').length)
  expect(filters).toBe(0)

  // A menu opened from inside a glass pane appears at the pointer, not offset by the pane.
  const tab = await h.page.getByTestId('session-tab').first().boundingBox()
  await h.page.mouse.click(tab!.x + 20, tab!.y + 10, { button: 'right' })
  const menu = await h.page.getByTestId('tab-menu').boundingBox()
  expect(Math.abs(menu!.x - (tab!.x + 20))).toBeLessThan(40)
  expect(Math.abs(menu!.y - (tab!.y + 10))).toBeLessThan(40)
  await h.page.keyboard.press('Escape')
  // The see-through terminal still draws its text.
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo glass-ok\n')
  await expect(h.page.getByTestId('terminal-shell').locator('.xterm-rows')).toContainText('glass-ok')
})

test('a fresh install starts on Liquid Glass; choosing the original look sticks', async () => {
  await h.close()
  h = await launchApiary({ realDefaultTheme: true })
  await expect(h.page.locator('html')).toHaveAttribute('data-material', 'glass')
  await openThemes(h.page)
  await expect(card(h.page, 'builtin:glass')).toHaveAttribute('data-active', 'true')
  await h.page.getByTestId('theme-reset').click()
  await expect(h.page.locator('html')).not.toHaveAttribute('data-material', 'glass')
  // A choice once made — the original look included — is kept over the default.
  await relaunchApiary(h, { APIARY_DEFAULT_THEME: '' })
  await expect(h.page.locator('html')).not.toHaveAttribute('data-material', 'glass')
})
