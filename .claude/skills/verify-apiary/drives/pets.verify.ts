import { test, expect } from '@playwright/test'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApiary } from '../../../../tests/e2e/helpers'
import { STARTER_PET } from '../../../../src/shared/pets/builtins'
import { note, shot } from './lib'

/**
 * A stand-in `claude` that answers the pet design prompt with a fixed pet and anything else with a
 * chat line, so turning pets on runs the real path (Settings → main → `claude -p` → validatePet →
 * pets.json → brain worker → 3D render) without spending tokens. Same shape as pets.spec.ts.
 */
function standInClaude(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-verify-pets-')))
  const envelope = (o: object): string => JSON.stringify({ type: 'result', is_error: false, ...o })
  writeFileSync(join(dir, 'design.json'), envelope({ structured_output: { ...STARTER_PET, name: 'Zippy' } }))
  writeFileSync(join(dir, 'chat.json'), envelope({ result: 'Hello from the bar!' }))
  const script = join(dir, 'claude')
  writeFileSync(script, [
    '#!/bin/sh',
    'for a; do last=$a; done',
    'case "$last" in',
    `  *"Design a tiny desktop pet"*) cat "${dir}/design.json" ;;`,
    `  *) cat "${dir}/chat.json" ;;`,
    'esac',
    '',
  ].join('\n'))
  chmodSync(script, 0o755)
  return script
}

test('pets: turning them on hatches a 3D pet on the status bar that chats', async () => {
  const h = await launchApiary({ claudeBin: standInClaude(), realDefaultTheme: true })
  try {
    await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog') })
    await h.page.getByTestId('settings-nav-pets').click()
    await h.page.getByTestId('setting-pets-enabled').click()
    await expect(h.page.getByTestId('pet-card-name')).toHaveValue('Zippy')
    await shot(h.page, '1-settings-hatched')
    await h.page.getByTestId('settings-cancel').click()

    const pet = h.page.getByTestId('pet')
    await expect(h.page.locator('[data-testid="pet"] .pet-sprite[data-render="3d"] .pet-body img')).toHaveCount(1, { timeout: 60_000 })
    const box = (await pet.boundingBox())!
    const floor = (await h.page.getByTestId('status-bar-floor').boundingBox())!
    note('pet-on-floor', { pet: box, floor, region: await pet.getAttribute('data-region') })
    await shot(h.page, '2-pet-on-bar')

    // Pets breathe, so Playwright never sees them as stable: click with the mouse at the centre.
    await h.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await h.page.getByTestId('pet-chat-input').fill('hi')
    await h.page.getByTestId('pet-chat-input').press('Enter')
    await expect(h.page.getByTestId('pet-chat-line').last()).toHaveText('Hello from the bar!')
    await shot(h.page, '3-chat')
  } finally {
    await h.close()
  }
})
