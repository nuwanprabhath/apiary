import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'
import { BUILTIN_THEMES } from '../../src/shared/theme/builtins'

/**
 * Describe a theme, and Claude designs it — driven with a stand-in `claude` that answers by what
 * it was asked, and records the prompt it got. tests/e2e/live/ does the same with the real one.
 */
let h: Harness
const first = { ...BUILTIN_THEMES[0].spec, name: 'Green Rain' }
const second = { ...BUILTIN_THEMES[1].spec, name: 'Greener Rain' }

async function useStandIn(): Promise<void> {
  const dir = h.home
  const envelope = (o: object): string => JSON.stringify({ type: 'result', is_error: false, structured_output: o })
  writeFileSync(join(dir, 'a.json'), envelope(first))
  writeFileSync(join(dir, 'b.json'), envelope(second))
  writeFileSync(join(dir, 'hostile.json'), envelope({ name: 'Hostile', palette: { bg: 'url(https://example.com/x.png)', accent: '#ff00aa', text: 'red; display:none' }, effects: [{ kind: 'fireworks' }] }))
  const script = join(dir, 'fake-claude.sh')
  writeFileSync(script, [
    '#!/bin/sh',
    'for a; do last=$a; done',
    `printf '%s' "$last" > "${dir}/last-prompt.txt"`,
    'case "$last" in',
    `  *HOSTILE*) cat "${dir}/hostile.json" ;;`,
    '  *FAILPLEASE*) echo "model overloaded" >&2; exit 1 ;;',
    '  *SLOWPLEASE*) sleep 30 ;;',
    `  *"Adjustment requested"*) cat "${dir}/b.json" ;;`,
    `  *) cat "${dir}/a.json" ;;`,
    'esac',
    '',
  ].join('\n'))
  chmodSync(script, 0o755)
  await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog') })
  await h.page.getByTestId('settings-nav-general').click()
  await h.page.getByTestId('claude-bin-input').fill(script)
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await useStandIn()
  await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog') })
  await h.page.getByTestId('settings-nav-themes').click()
})

test.afterEach(async () => { await h.close() })

const cssVar = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

test('generate previews the theme, refine adjusts it, back and forward step through versions, keep saves it', async () => {
  const original = await cssVar(h.page, '--accent')
  await h.page.getByTestId('theme-describe').fill('like the Matrix movie')
  await h.page.getByTestId('theme-generate').click()
  await expect(h.page.getByTestId('theme-preview-name')).toHaveText('Green Rain')
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#22ff5aff')
  // A preview is only a preview: nothing is saved or active yet.
  await expect(h.page.locator('[data-testid="theme-card"][data-theme-id="original"]')).toHaveAttribute('data-active', 'true')
  await expect(h.page.getByTestId('theme-effects-back')).toBeVisible()

  await h.page.getByTestId('theme-refine').fill('more neon please')
  await h.page.getByTestId('theme-refine-submit').click()
  await expect(h.page.getByTestId('theme-preview-name')).toHaveText('Greener Rain')
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#ff2a6dff')
  // The refinement carried the theme being refined.
  const prompt = readFileSync(join(h.home, 'last-prompt.txt'), 'utf8')
  expect(prompt).toContain('"name":"Green Rain"')
  expect(prompt).toContain('Adjustment requested:\nmore neon please')

  await h.page.getByTestId('theme-history-back').click()
  await expect(h.page.getByTestId('theme-preview-name')).toHaveText('Green Rain')
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#22ff5aff')
  await h.page.getByTestId('theme-history-forward').click()
  await expect(h.page.getByTestId('theme-preview-name')).toHaveText('Greener Rain')

  await h.page.getByTestId('theme-keep').click()
  await expect(h.page.getByTestId('theme-preview-bar')).toHaveCount(0)
  await expect(h.page.getByTestId('theme-card').filter({ hasText: 'Greener Rain' })).toHaveAttribute('data-active', 'true')
  expect(original).not.toBe('#ff2a6dff')

  await relaunchApiary(h)
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#ff2a6dff')
})

test('discard, or closing Settings mid-preview, puts back what was there', async () => {
  const original = await cssVar(h.page, '--accent')
  await h.page.getByTestId('theme-describe').fill('like the Matrix movie')
  await h.page.getByTestId('theme-generate').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#22ff5aff')
  await h.page.getByTestId('theme-discard').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe(original)

  await h.page.getByTestId('theme-generate').click()
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#22ff5aff')
  await h.page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
  await expect.poll(() => cssVar(h.page, '--accent')).toBe(original)
  await expect(h.page.getByTestId('theme-effects-back')).toHaveCount(0)
})

test('a hostile reply is shown only as its safe parts, and says what was ignored', async () => {
  const bg = await cssVar(h.page, '--bg')
  await h.page.getByTestId('theme-describe').fill('HOSTILE')
  await h.page.getByTestId('theme-generate').click()
  await expect(h.page.getByTestId('theme-preview-name')).toHaveText('Hostile')
  await expect(h.page.getByTestId('theme-preview-note')).toContainText('2 invalid colours ignored')
  await expect(h.page.getByTestId('theme-preview-note')).toContainText('1 unknown option ignored')
  expect(await cssVar(h.page, '--bg')).toBe(bg)
  await expect.poll(() => cssVar(h.page, '--accent')).toBe('#ff00aaff')
})

test('a failure leaves the look alone and says what went wrong; a slow one can be cancelled', async () => {
  const accent = await cssVar(h.page, '--accent')
  await h.page.getByTestId('theme-describe').fill('FAILPLEASE')
  await h.page.getByTestId('theme-generate').click()
  await expect(h.page.getByTestId('theme-generate-error')).toContainText('model overloaded')
  expect(await cssVar(h.page, '--accent')).toBe(accent)

  await h.page.getByTestId('theme-describe').fill('SLOWPLEASE')
  await h.page.getByTestId('theme-generate').click()
  await expect(h.page.getByTestId('theme-generating')).toBeVisible()
  await h.page.getByTestId('theme-generate-cancel').click()
  await expect(h.page.getByTestId('theme-generate-error')).toContainText('Cancelled')
  await expect(h.page.getByTestId('theme-generate')).toBeVisible()
})

test('the model a theme is designed with is a setting', async () => {
  await h.page.getByTestId('theme-model').selectOption('haiku')
  await relaunchApiary(h)
  expect(await h.page.evaluate(() => window.apiary.themeState().then((s) => s.options.model))).toBe('haiku')
})
