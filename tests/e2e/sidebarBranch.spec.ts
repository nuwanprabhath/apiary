import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * Which branch the sidebar's hover card is talking about.
 *
 * Reported as a contradiction: the card said `dev/1.0.12` while the bar under the very same
 * session said `dev/1.0.11`. Both were true — one is the branch recorded in the session's JSONL
 * when it ran, the other is the branch its worktree is checked out to today — and both were
 * labelled "Branch".
 */

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary({ staleBranchSession: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('the card leads with the branch the folder is on now, matching the session bar', async () => {
  await sidebarSession(h.page, 'Session from an older branch').click()
  // What the bar under the session says — the live branch of the checkout.
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')

  // Opening a session adds it to the Active section, which appears above the tree and pushes every
  // row down. That lands about half a second after the click, and a hover aimed before it arrives
  // is delivered to wherever the row used to be — the pointer never enters the row, so no card is
  // ever raised. Waiting for the section to exist first is what makes this test about the branch
  // label rather than about a race with an unrelated reflow.
  await expect(h.page.getByTestId('active-section')).toBeVisible()

  // Clicking hides the card and leaves the pointer on the row, so it takes a move away and back
  // to raise it again — deliberate, since the card has no business sitting over what you opened.
  await h.page.getByTestId('search-input').hover()
  // Scoped to the tree: once the session is open, the Active section lists it by the same title,
  // so a sidebar-wide match finds two rows — and only one of them is a session row with a hover
  // card behind it.
  await h.page.locator('.tree').getByText('Session from an older branch', { exact: true }).hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()

  const branchRow = card.locator('.hover-card-row', { hasText: 'Branch' })
  await expect(branchRow).toContainText('main')
  await expect(branchRow).not.toContainText('dev/1.0.12')
})

test('the branch the session ran on is still shown, named for what it is', async () => {
  // Not dropped: "this session was about dev/1.0.12" is worth knowing. It is just not "Branch".
  await sidebarSession(h.page, 'Session from an older branch').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card.locator('.hover-card-row', { hasText: 'Ran on' })).toContainText('dev/1.0.12')
})

test('a session still on its own branch says it once, not twice', async () => {
  await sidebarSession(h.page, 'Worktree session').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toContainText('feature/wt')
  await expect(card.locator('.hover-card-row', { hasText: 'Ran on' })).toHaveCount(0)
})
