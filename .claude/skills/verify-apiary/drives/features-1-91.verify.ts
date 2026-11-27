import { test, expect } from '@playwright/test'
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApiary, importAll } from '../../../../tests/e2e/helpers'
import { note, shot } from './lib'

/**
 * What 1.91.0 added, live: `!N` and `#N` in a session's title as links (opened through main, with
 * the browser stubbed), Claude Code's terminal-only "Heads up" note reaching the chat from a real
 * pty's screen, a code block's Copy button clear of its code, and Cmd/Ctrl+F plus wrapped tables in
 * the MR desk's popup.
 */
const R = process.cwd()
const RESIDENT = join(R, 'tests/fixtures/fake-claude-resident.mjs')
const FAKE_GLAB = join(R, 'tests/fixtures/bin/fake-glab-api.sh')
const TITLE = '!1776 #3258 Staging failed to update error'
const NOTE = 'The new build checkbox will only appear for branches that already contain the change, so the hotfix branch in your screenshot will not show it.'

const CODE = 'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::123456789012:user/exporter --action-names s3:GetObject s3:ListBucket --output json'
const BREAK = NOTE.indexOf(' the hotfix')

/** A stand-in claude that draws the note as Claude Code does: in the alternate screen, under the conversation. */
function claudeShowingNote(): string {
  const dir = mkdtempSync(join(tmpdir(), 'apiary-verify-note-'))
  const bin = join(dir, 'claude-note.sh')
  writeFileSync(bin, [
    '#!/bin/sh',
    "printf '\\033[?1049h'",
    "printf '● Applying the fixes now.\\r\\n\\r\\n'",
    // Claude Code wraps a note between words, its later lines indented under the first.
    `printf '✦ Heads up · ${NOTE.slice(0, BREAK)}\\r\\n'`,
    `printf '  ${NOTE.slice(BREAK + 1)}\\r\\n'`,
    "printf '  1: Learn more   2: Knew this already   0: Dismiss\\r\\n'",
    "printf '────────────────────────────────────────\\r\\n❯ '",
    'exec sleep 600',
  ].join('\n'))
  chmodSync(bin, 0o755)
  return bin
}

test('a session title links its MR and issue; a heads-up from the terminal shows in the chat', async () => {
  const h = await launchApiary({
    gitlabRemote: true, glabPath: FAKE_GLAB, sessionTitle: TITLE, claudeBin: claudeShowingNote(), settings: { transcriptChat: true },
  })
  const p = h.page
  try {
    await h.app.evaluate(({ shell }) => {
      const g = globalThis as { opened?: string[] }
      g.opened = []
      shell.openExternal = async (url: string) => { g.opened?.push(url) }
    })
    await importAll(p)
    await p.getByTestId('sidebar-refresh').click()
    await p.getByTestId('sidebar').getByText('Staging failed to update error', { exact: false }).first().click()

    const links = p.getByTestId('session-title').locator('a.ref-link')
    await expect(links).toHaveCount(2)
    const hrefs = await links.evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href')]))
    note('title-links', hrefs)
    expect(hrefs).toEqual([
      ['!1776 (merged)', 'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/1776'],
      ['#3258', 'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/issues/3258'],
    ])
    await links.nth(1).click()
    await expect.poll(() => h.app.evaluate(() => (globalThis as { opened?: string[] }).opened)).toEqual(['https://gitlab.com/ternandsparrow/paratoo-fdcp/-/issues/3258'])
    await expect(p.getByTestId('session-title-input')).toHaveCount(0)
    await shot(p, '1-title-links')

    // Resume runs the stand-in in a real pty; main reads the note off that screen.
    await p.getByTestId('resume-button').click()
    await p.getByTestId('view-transcript').click()
    const card = p.getByTestId('chat-terminal-notice')
    await expect(card).toBeVisible({ timeout: 15_000 })
    note('notice-card', await card.textContent())
    await expect(card).toContainText(`Heads up · ${NOTE}`)
    await expect(p.getByTestId('chat-terminal-notice-choices')).toHaveText('1: Learn more   2: Knew this already   0: Dismiss')
    await shot(p, '2-heads-up-in-chat')
    await p.getByTestId('chat-terminal-notice-open').click()
    await expect(p.getByTestId('transcript')).toBeHidden()
    await shot(p, '3-answered-in-terminal')
  } finally { await h.close() }
})

test('a resident\'s chat: a table wraps, a code block\'s Copy stays clear of its code, and Cmd/Ctrl+F finds in it', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-verify-regent-')))
  const table = '| Your ask | Status |\n| --- | --- |\n'
    + '| Confirm whether to block or flag a missing photo | Done. Huy agreed with Walid and Andrew to skip only the affected record, and nobody has objected since. |\n'
    + '| Exporter key has s3:GetObject before deploy | Only in the deploy checklist. Not confirmed by anyone who can see the key. |'
  writeFileSync(join(dir, 'scenarios.json'), JSON.stringify({ path: '', scenarios: { 'Status table': [{ text: `Here is where the thread stands.\n\n${table}\n\nCheck the key with:\n\n\`\`\`\n${CODE}\n\`\`\`\n\nThe thread is ready to resolve.` }] } }))
  const w = join(dir, 'claude')
  writeFileSync(w, `#!/bin/sh\nFAKE_RESIDENT_SCENARIOS=${JSON.stringify(join(dir, 'scenarios.json'))} exec node ${JSON.stringify(RESIDENT)} "$@"\n`)
  chmodSync(w, 0o755)
  const h = await launchApiary({ claudeBin: w })
  const p = h.page
  try {
    await importAll(p)
    await expect(async () => {
      await h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('apiary:open-settings-dialog') })
      await expect(p.getByTestId('settings-dialog')).toBeVisible({ timeout: 1000 })
    }).toPass()
    await p.getByTestId('settings-nav-residents').click()
    await p.getByTestId('resident-add-regent').click()
    await p.keyboard.press('Escape')
    const regent = p.locator('[data-testid^="resident-badge-regent"]').first()
    if ((await regent.getAttribute('data-state')) === 'asleep') {
      await regent.click({ button: 'right' })
      await p.getByTestId('resident-menu').getByRole('menuitem', { name: 'Turn on' }).click()
    }
    await regent.click()
    const popup = p.getByTestId('resident-popup')
    await popup.getByRole('textbox').fill('Status table please')
    await popup.getByRole('textbox').press('Enter')
    const cells = popup.locator('table td')
    await expect(cells).toHaveCount(4, { timeout: 15_000 })
    await expect(popup).toContainText('ready to resolve')
    const fit = await popup.locator('table').evaluate((t) => {
      const cell = t.querySelectorAll('td')[1] as HTMLElement
      return { scrollWidth: t.scrollWidth, clientWidth: t.clientWidth, cellHeight: cell.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(cell).lineHeight) }
    })
    note('table-fit', fit)
    expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth)
    expect(fit.cellHeight).toBeGreaterThan(2 * fit.lineHeight)
    await shot(p, '4-regent-table-wraps')

    // The code's long line scrolls sideways; at either end, no line of it is under the Copy button.
    const clear = await popup.locator('.code-block').evaluate((block) => {
      const button = (block.querySelector('.code-copy') as HTMLElement).getBoundingClientRect()
      const pre = block.querySelector('pre') as HTMLElement
      const range = document.createRange()
      range.selectNodeContents(pre.querySelector('code') as HTMLElement)
      const hits: number[] = []
      for (const left of [0, pre.scrollWidth]) {
        pre.scrollLeft = left
        for (const r of range.getClientRects()) if (r.left < button.right && button.left < r.right && r.top < button.bottom && button.top < r.bottom) hits.push(left)
      }
      return { scrolls: pre.scrollWidth > pre.clientWidth, overlaps: hits.length }
    })
    note('copy-button', clear)
    expect(clear).toEqual({ scrolls: true, overlaps: 0 })

    await popup.getByTestId('resident-conversation').click()
    await p.keyboard.press('ControlOrMeta+f')
    const input = popup.getByTestId('find-input')
    await expect(input).toBeFocused()
    await p.keyboard.type('thread')
    await expect(popup.getByTestId('find-count')).toHaveText('2 of 2')
    note('find-count', await popup.getByTestId('find-count').textContent())
    await shot(p, '5-regent-find')
    await p.keyboard.press('Escape')
    await expect(popup.getByTestId('find-bar')).toHaveCount(0)
  } finally { await h.close() }
})
