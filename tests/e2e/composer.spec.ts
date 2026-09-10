import { test, expect } from '@playwright/test'
import { writeFileSync, chmodSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/** A 1x1 PNG, small enough to paste inline and still be a real image on disk. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/**
 * Points `claudeBin` at a script that just execs the login shell, the same stand-in newSession.spec
 * uses. It makes the session's process something a test can actually converse with: whatever the
 * composer types arrives at a real prompt, and its output comes back on screen — which is the only
 * way to prove the message was delivered *and* submitted, rather than left sitting in a buffer.
 */
async function useFakeClaudeShell(h: Harness): Promise<void> {
  const script = join(h.home, 'fake-claude.sh')
  writeFileSync(script, '#!/bin/sh\nexec "$SHELL" -l\n')
  chmodSync(script, 0o755)
  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-general').click()
  await h.page.getByTestId('claude-bin-input').fill(script)
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

/** Pastes an image into the composer the way a real paste arrives: as a file on the event. */
async function pasteImage(h: Harness, base64 = TINY_PNG): Promise<void> {
  await h.page.getByTestId('composer-input').evaluate((el, data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'pasted.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, base64)
}

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('the transcript has a chat box, and what you type reaches the running session', async () => {
  await useFakeClaudeShell(h)
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('composer')).toBeVisible()
  // Before resuming, the box says where a message would go rather than pretending to be connected.
  await expect(h.page.getByTestId('composer-hint')).toContainText(/resume/i)

  await h.page.getByTestId('composer-input').fill('echo APIARY_FROM_COMPOSER')
  await h.page.getByTestId('composer-send').click()

  // Sending resumed the session and switched to it, and the message actually arrived and ran.
  await expect(h.page.getByTestId('terminal-session')).toBeVisible({ timeout: 20000 })
  await expect(h.page.getByTestId('terminal-session')).toContainText('APIARY_FROM_COMPOSER', {
    timeout: 30000,
  })
  // The box empties on send, so the next message starts clean.
  await expect(h.page.getByTestId('composer-input')).toHaveValue('')
})

test('Enter sends and Shift+Enter makes a new line', async () => {
  await useFakeClaudeShell(h)
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  const input = h.page.getByTestId('composer-input')
  await input.fill('first')
  await input.press('Shift+Enter')
  await input.pressSequentially('second')
  await expect(input).toHaveValue('first\nsecond')

  await input.press('Enter')
  await expect(input).toHaveValue('', { timeout: 20000 })
})

test('a pasted image becomes a thumbnail you can enlarge, and can be removed again', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('composer-attachments')).toHaveCount(0)

  await pasteImage(h)
  await expect(h.page.getByTestId('composer-attachment')).toHaveCount(1)

  // Click the preview to see it full size — the thing the terminal could never do.
  await h.page.getByTestId('composer-attachment-preview').click()
  await expect(h.page.getByTestId('image-lightbox')).toBeVisible()
  await expect(h.page.getByTestId('image-lightbox-image')).toBeVisible()
  await h.page.keyboard.press('Escape')
  await expect(h.page.getByTestId('image-lightbox')).toHaveCount(0)

  await h.page.getByTestId('composer-attachment-remove').click()
  await expect(h.page.getByTestId('composer-attachment')).toHaveCount(0)
})

test('a pasted image is written to disk and its path is what gets sent', async () => {
  await useFakeClaudeShell(h)
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  await pasteImage(h)
  await expect(h.page.getByTestId('composer-attachment')).toHaveCount(1)
  await h.page.getByTestId('composer-input').fill('look at this')
  await h.page.getByTestId('composer-send').click()

  // The file really exists, in Apiary's own data directory rather than the session's repository.
  const imagesDir = join(h.home, 'pasted-images')
  await expect.poll(() => {
    try { return readdirSync(imagesDir).filter((f) => f.endsWith('.png')).length } catch { return 0 }
  }, { timeout: 20000 }).toBe(1)

  // And the path is what reached the session — that is how Claude gets to read the image.
  const file = readdirSync(imagesDir).find((f) => f.endsWith('.png'))
  await expect(h.page.getByTestId('terminal-session')).toContainText(String(file), { timeout: 30000 })
})

test('images already in a session render as thumbnails in the transcript', async () => {
  // Blocks the reader used to drop entirely, so a conversation that included a screenshot showed
  // a gap where the screenshot had been.
  const { makeSession } = await import('../fixtures/makeSession')
  makeSession(h.projectsRoot, '-work-a', {
    sessionId: '99999999-9999-9999-9999-999999999999',
    cwd: h.workdir,
    title: 'Has an image in it',
    extraLines: [
      JSON.stringify({
        sessionId: '99999999-9999-9999-9999-999999999999',
        cwd: h.workdir,
        gitBranch: 'main',
        isSidechain: false,
        version: '2.1.246',
        type: 'user',
        uuid: 'with-image',
        timestamp: '2026-09-02T10:00:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'here is a screenshot' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: TINY_PNG } },
          ],
        },
      }),
    ],
  })
  // Scan first: `discovered()` reports what the store knows, and the store only learns about a
  // file that appeared after startup once something has rescanned.
  await h.page.evaluate(async () => {
    await window.apiary.refresh()
    const all = await window.apiary.discovered()
    await window.apiary.importSessions(all.map((s) => s.sessionId), [])
  })
  await h.page.getByTestId('sidebar-refresh').click()

  await sidebarSession(h.page, 'Has an image in it').click()
  const thumb = h.page.getByTestId('transcript').getByTestId('image-thumb')
  await expect(thumb).toHaveCount(1, { timeout: 20000 })

  await thumb.click()
  await expect(h.page.getByTestId('image-lightbox-image')).toBeVisible()
})
