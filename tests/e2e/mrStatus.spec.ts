import { test, expect } from '@playwright/test'
import { join } from 'node:path'
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
