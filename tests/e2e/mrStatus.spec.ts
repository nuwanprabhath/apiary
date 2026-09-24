import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

const FAKE_GLAB = join(process.cwd(), 'scripts/fixtures/fake-glab-api.sh')

let h: Harness
test.afterEach(async () => { await h.close() })

test('a session titled with an MR reference shows its resolved status', async () => {
  h = await launchApiary({ gitlabRemote: true, glabPath: FAKE_GLAB, sessionTitle: 'Ship !1267' })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  // Not an exact match: once the lookup resolves, the row's text becomes "Ship !1267 (merged)",
  // which the plain title no longer equals.
  const row = sidebarSession(h.page, 'Ship !1267', { exact: false })
  await expect(row).toContainText('!1267 (merged)')
})

test('the Active row for an open session shows its MR status too', async () => {
  // Active is the mission-control view: it exists so the state of a session can be read without
  // going to it. A row that shows the bare title while the same session, two sections below in
  // Pinned, reads "(merged)" makes the two disagree about the same thing — and the one meant to
  // be glanced at is the one that is wrong.
  h = await launchApiary({ gitlabRemote: true, glabPath: FAKE_GLAB, sessionTitle: 'Ship !1267' })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()

  await sidebarSession(h.page, 'Ship !1267', { exact: false }).click()

  const activeRow = h.page.getByTestId('active-section').getByTestId('active-tab-row')
  await expect(activeRow).toHaveCount(1)
  await expect(activeRow).toContainText('!1267 (merged)')
})

test('Refresh picks up a merge that happened while the app was open, in Active as everywhere', async () => {
  // Reported: `!1328` was merged, Active still said "opened", and Refresh did not change it. A row
  // asked for its MR state once, when it mounted, and the main process kept every answer for ten
  // minutes. Refresh now discards the cache and every row asks again.
  h = await launchApiary({ gitlabRemote: true, glabPath: FAKE_GLAB, sessionTitle: 'Ship !1267' })
  writeFileSync(join(h.home, 'glab-state'), 'opened')
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Ship !1267', { exact: false }).first().click()

  const activeRow = h.page.getByTestId('active-section').getByTestId('active-tab-row')
  await expect(activeRow).toContainText('!1267 (opened)')

  writeFileSync(join(h.home, 'glab-state'), 'merged')
  await h.page.getByTestId('sidebar-refresh').click()

  await expect(activeRow).toContainText('!1267 (merged)')
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'Ship !1267' }).first()).toContainText('(merged)')
})
