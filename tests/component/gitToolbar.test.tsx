import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import type { FakeApiary, FakeOptions } from './fakeApiary'
import type { GitRefEntry } from '@shared/types'

/** A ref entry with the same shape `fakeApiary.ts`'s own fixture refs use. */
function ref(name: string): GitRefEntry {
  return { name, relativeDate: '2 days ago', author: 'Test', shortSha: 'abc1234', subject: `tip of ${name}` }
}

describe('the git toolbar', () => {
  /** Renders the app, opens "Repo root session" and shows its shell — the branch switcher and the
   *  rest of the git toolbar only appear once a session with a git status is open. */
  async function open(opts: FakeOptions = {}): Promise<FakeApiary> {
    const { fake } = await renderApp(opts)
    await userEvent.click(sidebarSession('Repo root session'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
    return fake
  }

  it('switches branch via the branch switcher', async () => {
    await open({
      refs: { current: 'main', local: [ref('main'), ref('feature/from-switcher')], remote: [], tags: [] },
    })

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'feature')
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('feature/from-switcher', { exact: true }))

    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('feature/from-switcher')
  })

  it('a branch row copies its name on hover, without checking it out', async () => {
    const fake = await open({
      refs: { current: 'main', local: [ref('main'), ref('feature/copy-me')], remote: [], tags: [] },
    })

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'copy-me')
    const row = page.getByTestId('branch-switcher-branch-row').getByText('feature/copy-me', { exact: true }).element()
    const item = row.closest('.branch-switcher-item') as HTMLElement
    const copy = item.querySelector('[data-testid="branch-switcher-copy"]') as HTMLElement
    // Out of the way until the row is hovered.
    await expect.element(copy).not.toBeVisible()
    await userEvent.hover(item)
    await userEvent.click(copy)

    await expect.element(copy).toHaveAttribute('data-copied', 'true')
    expect(fake.callsTo('copyToClipboard')).toContainEqual(['feature/copy-me'])
    // Copying is not picking: the switcher stays open and the branch is unchanged.
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('main')
  })

  it('Enter checks out an exact branch name; a partial one does nothing', async () => {
    await open({
      refs: { current: 'main', local: [ref('main'), ref('feature/exact-enter')], remote: [], tags: [] },
    })

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    // Wait for the refs to actually be loaded before typing — the search input accepts keystrokes
    // immediately on open, but Enter's exact-match check is computed against the fetched ref list,
    // which arrives asynchronously, even from the fake.
    await expect.element(page.getByTestId('branch-switcher-branch-row').getByText('feature/exact-enter', { exact: true })).toBeVisible()
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'feature/exact-enter')
    await userEvent.keyboard('{Enter}')

    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('feature/exact-enter')

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'feature/exact')
    await userEvent.keyboard('{Enter}')

    // Still open, and still on the branch it started on — a partial match is not a choice.
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
  })

  it('a second Enter while a checkout is in flight does not fire a second checkout', async () => {
    const fake = await open({
      refs: { current: 'main', local: [ref('main'), ref('feature/slow-checkout')], remote: [], tags: [] },
    })

    // A held checkout — the same kind of window a real `post-checkout` hook that sleeps opens in
    // the e2e version of this test — so a second Enter pressed before it resolves proves whether
    // the keyboard path's busy guard (mirroring the row buttons' `disabled={busy}`) actually stops
    // a second concurrent checkout.
    let calls = 0
    let resolveCheckout: (() => void) | null = null
    fake.override('gitCheckoutBranch', async (_key, _isPtyId, name) => {
      calls += 1
      await new Promise<void>((resolve) => { resolveCheckout = resolve })
      fake.state.refs = { ...fake.state.refs, current: name }
      return { ok: true }
    })

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await expect.element(page.getByTestId('branch-switcher-branch-row').getByText('feature/slow-checkout', { exact: true })).toBeVisible()
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'feature/slow-checkout')
    await userEvent.keyboard('{Enter}')
    // The checkout is still held when this lands — without the busy guard this fires a second
    // gitCheckoutBranch for the same ref.
    await userEvent.keyboard('{Enter}')
    expect(calls).toBe(1)

    resolveCheckout!()
    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('feature/slow-checkout')
    expect(calls).toBe(1)
  })

  it('creates a new branch from the branch switcher', async () => {
    await open()
    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.click(page.getByTestId('branch-switcher-create'))
    await userEvent.fill(page.getByTestId('branch-switcher-name-input'), 'feature/created-in-test')
    await userEvent.click(page.getByTestId('branch-switcher-confirm'))

    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('feature/created-in-test')
  })

  it('creates a new branch from a picked base ref', async () => {
    await open({
      refs: { current: 'main', local: [ref('main'), ref('base-branch')], remote: [], tags: [] },
    })

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.click(page.getByTestId('branch-switcher-create-from'))
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('base-branch', { exact: true }))
    await userEvent.fill(page.getByTestId('branch-switcher-name-input'), 'feature/from-base')
    await userEvent.click(page.getByTestId('branch-switcher-confirm'))

    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('feature/from-base')
  })

  it('checks out a tag detached', async () => {
    // 'v1.0.0' is the fake's own default tag fixture — no need to add one.
    await open()
    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.click(page.getByTestId('branch-switcher-detached'))
    await userEvent.click(page.getByTestId('branch-switcher-tag-row').getByText('v1.0.0', { exact: true }))

    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
    // Detached HEAD has no branch name, but the branch button must stay visible (as a dead end
    // otherwise) — it just switches to a detached-HEAD label. Clicking it must still reopen the
    // branch switcher, the only way back to a named branch.
    const branchButton = page.getByTestId('toolbar-branch-button')
    await expect.element(branchButton).toBeVisible()
    await expect.element(branchButton).toHaveTextContent(/detached/i)

    await userEvent.click(branchButton)
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
  })

  it('shows a failed checkout inside the branch switcher, without closing it', async () => {
    // A checkout that fails for an ordinary reason — a ref that already exists — is reported inside
    // the modal rather than behind it: the modal's own backdrop covers the app's error banner, so an
    // error routed only to the parent would be invisible. (A branch held by another worktree is not
    // this case; it is an outcome with actions, see the worktree tests below.)
    const fake = await open()
    fake.override('gitCreateBranch', async (_key, _isPtyId, name) => {
      if (fake.state.refs.local.some((r) => r.name === name)) {
        throw new Error(`fatal: A branch named '${name}' already exists`)
      }
      fake.state.refs = { ...fake.state.refs, current: name, local: [...fake.state.refs.local, ref(name)] }
    })

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
    await userEvent.click(page.getByTestId('branch-switcher-create'))
    await userEvent.fill(page.getByTestId('branch-switcher-name-input'), 'main')
    await userEvent.click(page.getByTestId('branch-switcher-confirm'))

    await expect.element(page.getByTestId('branch-switcher')).toBeVisible()
    await expect.element(page.getByTestId('branch-switcher-error')).toBeVisible()
    await expect.element(page.getByTestId('branch-switcher-error')).toHaveTextContent(/already exists/i)
  })

  it('a branch another worktree has offers to pull it there, or open a session there', async () => {
    // `feature/wt` is checked out in repo-c-wt in the fake's own fixture (see fakeApiary.ts's
    // FIXTURE_PROJECTS), so git refuses this checkout. On a repository with a worktree per ticket
    // that refusal is the normal answer, not a failure — and being shown git's sentence and left to
    // go and find that directory by hand is the slow part.
    const fake = await open()
    fake.override('gitCheckoutBranch', async (_key, _isPtyId, name) => (
      name === 'feature/wt'
        ? { ok: false, conflict: { branch: 'feature/wt', worktreePath: '/fixture/repo-c-wt', label: 'repo-c-wt' } }
        : { ok: true }
    ))

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'feature/wt')
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('feature/wt', { exact: true }))

    const dialog = page.getByTestId('worktree-conflict-dialog')
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog).toHaveTextContent('feature/wt')
    await expect.element(page.getByTestId('worktree-conflict-label')).toHaveTextContent('repo-c-wt')
    // The branch switcher gets out of the way rather than showing this inside a branch list.
    await expect.element(page.getByTestId('branch-switcher')).not.toBeInTheDocument()
    // And nothing was checked out: the session's own branch is untouched.
    await expect.element(page.getByTestId('toolbar-branch-button')).toHaveTextContent('main')
  })

  it('opening a session in that worktree starts it in the worktree, not the repo root', async () => {
    const fake = await open()
    fake.override('gitCheckoutBranch', async (_key, _isPtyId, name) => (
      name === 'feature/wt'
        ? { ok: false, conflict: { branch: 'feature/wt', worktreePath: '/fixture/repo-c-wt', label: 'repo-c-wt' } }
        : { ok: true }
    ))

    await userEvent.click(page.getByTestId('toolbar-branch-button'))
    await userEvent.fill(page.getByTestId('branch-switcher-search'), 'feature/wt')
    await userEvent.click(page.getByTestId('branch-switcher-branch-row').getByText('feature/wt', { exact: true }))
    await userEvent.click(page.getByTestId('worktree-conflict-session'))

    await expect.element(page.getByTestId('worktree-conflict-dialog')).not.toBeInTheDocument()
    // A new tab, showing the worktree's own directory in the header.
    await until(() => page.getByTestId('session-path').elements().some((el) => el.textContent?.includes('repo-c-wt') === true))
  })
})
