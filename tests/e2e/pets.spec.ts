import { test, expect } from '@playwright/test'
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApiary, relaunchApiary, type Harness } from './helpers'
import { STARTER_PET } from '../../src/shared/pets/builtins'

/**
 * Pets through the real app: main's store and `claude -p` calls (answered by a stand-in that
 * replies by what it was asked), the brain worker, the status bar and the rail.
 */
let h: Harness
let dir: string

function standIn(): string {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-pets-e2e-')))
  const envelope = (o: object): string => JSON.stringify({ type: 'result', is_error: false, ...o })
  writeFileSync(join(dir, 'design.json'), envelope({ structured_output: { ...STARTER_PET, name: 'Zippy', body: { ...STARTER_PET.body, shape: 'heart', color: '#ff3fae' } } }))
  writeFileSync(join(dir, 'chat.json'), envelope({ result: 'Ribbit! I mean, hello!' }))
  writeFileSync(join(dir, 'voice.json'), envelope({ structured_output: { lines: { idle: ['Fresh thought!'] } } }))
  const script = join(dir, 'claude')
  writeFileSync(script, [
    '#!/bin/sh',
    'for a; do last=$a; done',
    'case "$last" in',
    `  *"Design a tiny desktop pet"*) cat "${dir}/design.json" ;;`,
    `  *"Write fresh lines"*) cat "${dir}/voice.json" ;;`,
    `  *) cat "${dir}/chat.json" ;;`,
    'esac',
    '',
  ].join('\n'))
  chmodSync(script, 0o755)
  return script
}

async function openPetSettings(): Promise<void> {
  await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog') })
  await h.page.getByTestId('settings-nav-pets').click()
  await expect(h.page.getByTestId('pets-section')).toBeVisible()
}

/** A pet is always breathing, never "stable" to Playwright: click where it is with the mouse. */
async function clickPet(button: 'left' | 'right' = 'left'): Promise<void> {
  const b = (await h.page.getByTestId('pet').boundingBox())!
  await h.page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button })
}

async function closeSettings(): Promise<void> {
  await h.page.getByTestId('settings-cancel').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

test.beforeEach(async () => { h = await launchApiary({ claudeBin: standIn() }) })

test.afterEach(async () => { await h.close() })

test('turning pets on hatches one that walks the status bar, climbs the rail, resizes and chats', async () => {
  await openPetSettings()
  // Applied by main, then shown: the box follows `petsChanged`, not the click itself.
  await h.page.getByTestId('setting-pets-enabled').click()
  await expect(h.page.getByTestId('setting-pets-enabled')).toBeChecked()
  await expect(h.page.getByTestId('pet-card-name')).toHaveValue('Zippy')
  await closeSettings()

  const pet = h.page.getByTestId('pet')
  await expect(pet).toBeVisible()
  // Rendered in 3D by the worker, on the real GPU, and swapped in.
  await expect(h.page.locator('[data-testid="pet"] .pet-sprite[data-render="3d"] .pet-body img')).toHaveCount(1, { timeout: 60_000 })
  const floor = (await h.page.getByTestId('status-bar-floor').boundingBox())!
  await expect.poll(async () => { const b = (await pet.boundingBox())!; return Math.abs(b.y + b.height - (floor.y + floor.height - 2)) <= 1 }).toBe(true)

  // Onto the rail, by hand.
  await h.page.getByTestId('sidebar-hide').click()
  const rail = (await h.page.getByTestId('sidebar-rail').boundingBox())!
  const from = (await pet.boundingBox())!
  await h.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await h.page.mouse.down()
  await h.page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2, { steps: 10 })
  await h.page.mouse.up()
  await expect(pet).toHaveAttribute('data-region', 'rail')
  // The rail goes when the sidebar comes back; the pet comes down to the bar.
  await h.page.getByTestId('sidebar-show').click()
  await expect(pet).toHaveAttribute('data-region', 'bar')

  await clickPet('right')
  await h.page.getByRole('menuitemcheckbox', { name: 'Extra large' }).click()
  await expect.poll(async () => (await pet.boundingBox())?.width).toBe(128)

  await clickPet()
  await h.page.getByTestId('pet-chat-input').fill('hi there')
  await h.page.getByTestId('pet-chat-input').press('Enter')
  await expect(h.page.getByTestId('pet-chat-line').last()).toHaveText('Ribbit! I mean, hello!')
})

test('pets survive a relaunch, and export to a file that imports as a new pet', async () => {
  await openPetSettings()
  // Applied by main, then shown: the box follows `petsChanged`, not the click itself.
  await h.page.getByTestId('setting-pets-enabled').click()
  await expect(h.page.getByTestId('setting-pets-enabled')).toBeChecked()
  await expect(h.page.getByTestId('pet-card')).toHaveCount(1)
  await closeSettings()

  const file = join(dir, 'zippy.apiarypet.json')
  await relaunchApiary(h, { APIARY_PET_EXPORT_PATH: file, APIARY_PET_IMPORT_PATH: file })
  await expect(h.page.getByTestId('pet')).toBeVisible()

  await openPetSettings()
  await h.page.getByTestId('pet-card-export').click()
  await expect.poll(() => existsSync(file)).toBe(true)
  const exported = JSON.parse(readFileSync(file, 'utf8')) as { apiaryPet: number; spec: { name: string; body: { shape: string } } }
  expect([exported.apiaryPet, exported.spec.name, exported.spec.body.shape]).toEqual([1, 'Zippy', 'heart'])

  await h.page.getByTestId('pet-import').click()
  await expect(h.page.getByTestId('pet-card')).toHaveCount(2)
  await closeSettings()
  await expect(h.page.getByTestId('pet')).toHaveCount(2)
})
