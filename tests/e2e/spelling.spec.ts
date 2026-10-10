import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()
})

test.afterEach(async () => { await h.close() })

test('the machine has a spellchecker dictionary, which flags "recieve" and suggests "receive"', async () => {
  const languages = await h.app.evaluate(({ session }) => session.defaultSession.availableSpellCheckerLanguages)
  expect(languages, 'this proof needs a spellchecker dictionary installed on the machine').not.toHaveLength(0)

  const { misspelled, suggestions } = await h.page.evaluate(() => window.apiary.spellingCheck('recieve'))
  expect(misspelled).toBe(true)
  expect(suggestions).toContain('receive')
})

test('a left-click on a misspelled word offers the suggestions, and choosing one replaces the word', async () => {
  const input = h.page.getByTestId('composer-input')
  await input.fill('recieve')

  // The middle of the box is past the end of the text, so the caret lands after the word.
  await input.click()
  const menu = h.page.getByTestId('spelling-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'receive', exact: true }).click()

  await expect(input).toHaveValue('receive')
  await expect(menu).toHaveCount(0)
})

test('Paste from the menu puts the clipboard into the box', { tag: '@serial' }, async () => {
  await h.app.evaluate(({ clipboard }) => clipboard.writeText('PASTED'))
  const input = h.page.getByTestId('composer-input')
  await input.fill('hello ')

  await input.click({ button: 'right' })
  await h.page.getByTestId('text-menu').getByRole('menuitem', { name: 'Paste', exact: true }).click()

  await expect(input).toHaveValue('hello PASTED')
})
