import { test, expect, type Page } from '@playwright/test'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * The merge-request button, end to end.
 *
 * `glab` is a fixture script (scripts/fixtures/fake-glab.sh) rather than a stub inside the app, so
 * the spawn, the argument list and the JSON parsing all stay in the test's path — which is where
 * the mistakes in this plugin would be. What is *not* covered is a real GitLab: that needs a login
 * and a project, and is the part to try by hand.
 */

const FAKE_GLAB = join(process.cwd(), 'scripts/fixtures/fake-glab.sh')

let h: Harness
test.afterEach(async () => { await h.close() })

async function launch(opts: Parameters<typeof launchApiary>[0] = {}): Promise<void> {
  h = await launchApiary({ gitlabRemote: true, glabPath: FAKE_GLAB, ...opts })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  // The repo-root session is the one in the folder carrying the GitLab remote.
  await sidebarSession(h.page, 'Repo root session').click()
}

/**
 * Records what the app asks the OS to open, instead of actually opening a browser mid-test.
 * Replaces `shell.openExternal` in the real main process, the same way the transcript specs
 * replace an IPC handler.
 */
async function captureOpenExternal(page: Page, h: Harness): Promise<() => Promise<string[]>> {
  await h.app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as unknown as { __opened: string[] }).__opened = opened
    shell.openExternal = async (url: string) => { opened.push(url) }
  })
  void page
  return async () => h.app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened)
}

test('a branch with a merge request gets a button showing its number', async () => {
  await launch()

  const button = h.page.getByTestId('plugin-gitlab-mr-mr')
  await expect(button).toBeVisible()
  await expect(button).toContainText('!1255')
  // The tooltip carries the sentence the bar has no room for.
  await expect(button).toHaveAttribute('title', /fix\(cypress\)/)
})

test('clicking the merge-request button opens it in a browser', async () => {
  await launch()
  const opened = await captureOpenExternal(h.page, h)

  await h.page.getByTestId('plugin-gitlab-mr-mr').click()

  await expect.poll(opened).toEqual([
    'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/1255',
  ])
})

test('a branch with no merge request offers to create one on GitLab', async () => {
  await launch({ glabEmpty: true })
  const opened = await captureOpenExternal(h.page, h)

  const button = h.page.getByTestId('plugin-gitlab-mr-mr-new')
  await expect(button).toBeVisible()
  await expect(button).toContainText('MR')

  await button.click()
  // GitLab's own new-merge-request form, with the branch already chosen — creating one involves a
  // title, a description and reviewers, which belong in GitLab and not in a button.
  await expect.poll(opened).toEqual([
    'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/new'
    + '?merge_request%5Bsource_branch%5D=main',
  ])
})

test('when glab cannot answer, the button still offers to create one', async () => {
  // No login, no network, no glab at all: the half of the button that needs only the git remote
  // keeps working rather than the whole thing disappearing.
  await launch({ glabFails: true })
  await expect(h.page.getByTestId('plugin-gitlab-mr-mr-new')).toBeVisible()
})

test('a repository with no GitLab remote gets no button at all', async () => {
  h = await launchApiary({ glabPath: FAKE_GLAB })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Fix CSV export bug').click()

  await expect(h.page.getByTestId('toolbar-branch-button').or(h.page.getByTestId('shell-toggle')).first())
    .toBeVisible()
  await expect(h.page.getByTestId('plugin-gitlab-mr-mr')).toHaveCount(0)
  await expect(h.page.getByTestId('plugin-gitlab-mr-mr-new')).toHaveCount(0)
})

test('the plugin can be switched off, and its button goes with it', async () => {
  await launch()
  await expect(h.page.getByTestId('plugin-gitlab-mr-mr')).toBeVisible()

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('settings-nav-plugins').click()
  await h.page.getByTestId('setting-plugin-gitlab-mr').uncheck()
  await h.page.getByTestId('settings-save').click()

  await expect(h.page.getByTestId('plugin-gitlab-mr-mr')).toHaveCount(0)
})
