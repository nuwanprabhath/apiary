import { afterEach, describe, it, expect } from 'vitest'
import { page } from 'vitest/browser'
import { renderApp } from './renderApp'
import { clickRowAction, stays, until } from './helpers'
import type { FakeApiary } from './fakeApiary'

// The sidebar's arrangement and each chat's settings are main's library state, not this window's
// localStorage: a remote window must show the work machine's. These pin the renderer's half.

const all = (id: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
const sessionIdOf = (fake: FakeApiary, title: string): string =>
  fake.state.sessions.find((s) => s.title === title)?.sessionId ?? ''

/** What a 1.38 install left in localStorage: a group, a pin and a chat's choice. */
function leaveOldLocalStorage(pinned: string): void {
  localStorage.setItem('apiary.shared', JSON.stringify({
    pinned: [pinned], groups: [{ id: 'old', name: 'From before' }], groupAssignments: { '/fixture/work-a': 'old' }, sidebarWidth: 1,
  }))
  localStorage.setItem('apiary.chatSettings', JSON.stringify({ [pinned]: { showToolCalls: false } }))
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

describe('library state in the sidebar', () => {
  it('draws the groups main holds', async () => {
    await renderApp({ library: { groups: [{ id: 'g', name: 'Work' }], groupAssignments: { '/fixture/work-a': 'g' } } })
    await expect.element(page.getByTestId('folder-group')).toBeVisible()
    expect(all('folder-group')[0]?.textContent).toContain('Work')
  })

  it('pins and unpins through main, and draws what main pushes back', async () => {
    const { fake } = await renderApp({ library: {} })
    await until(() => all('session-item').length === 4)
    await clickRowAction('Worktree session', 'pin-session-button')
    await until(() => all('pinned-section').length === 1)
    const id = sessionIdOf(fake, 'Worktree session')
    expect(fake.callsTo('setLibraryState')).toEqual([[{ pinned: [id] }]])
    expect(fake.state.library.state.pinned).toEqual([id])

    fake.state.library = { ...fake.state.library, state: { ...fake.state.library.state, pinned: [] } }
    fake.emit('libraryStateChanged', fake.state.library)
    await until(() => all('pinned-section').length === 0)
  })

  it('keeps both of two changes made before main answers the first', async () => {
    // Over a remote connection main answers after a round trip; a second pin made meanwhile must
    // build on the first, not on the state from before it (or it unpins the first).
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { fake } = await renderApp({ library: {} }, (f) => {
      f.override('setLibraryState', async (patch) => {
        await gate
        f.state.library = { state: { ...f.state.library.state, ...patch }, seeded: true }
        f.emit('libraryStateChanged', f.state.library)
        return f.state.library
      })
    })
    await until(() => all('session-item').length === 4)
    await clickRowAction('Worktree session', 'pin-session-button')
    await clickRowAction('Repo root session', 'pin-session-button')
    release()
    await expect.poll(() => [...fake.state.library.state.pinned].sort())
      .toEqual([sessionIdOf(fake, 'Worktree session'), sessionIdOf(fake, 'Repo root session')].sort())
  })
})
// A chat's tool calls hidden by library state: toolIoToggle.test.tsx ("starts hidden when…").

describe('the move out of localStorage', () => {
  it('a local window seeds main once from what 1.38 kept, and the sidebar shows it', async () => {
    const { fake } = await renderApp({}, (f) => { leaveOldLocalStorage(sessionIdOf(f, 'Worktree session')) })
    const id = sessionIdOf(fake, 'Worktree session')
    await expect.poll(() => fake.callsTo('seedLibraryState').length).toBe(1)
    expect(fake.callsTo('seedLibraryState')[0]?.[0]).toEqual({
      pinned: [id], groups: [{ id: 'old', name: 'From before' }], groupAssignments: { '/fixture/work-a': 'old' },
      chatSettings: { [id]: { showToolCalls: false } },
    })
    await until(() => all('pinned-section').length === 1)
    await expect.element(page.getByTestId('folder-group')).toBeVisible()
    // Left in place: a downgrade still finds what it had.
    expect(localStorage.getItem('apiary.shared')).not.toBeNull()
  })

  it('a local window does not seed a library that is already seeded', async () => {
    const { fake } = await renderApp({ librarySeeded: true }, (f) => { leaveOldLocalStorage(sessionIdOf(f, 'Worktree session')) })
    await until(() => all('session-item').length === 4)
    await stays(() => fake.callsTo('seedLibraryState').length === 0, 300, 'no seed of a seeded library')
    expect(all('pinned-section')).toHaveLength(0)
  })

  it('a remote window never seeds the work machine with home\'s localStorage', async () => {
    history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=work-box`)
    const { fake } = await renderApp({}, (f) => { leaveOldLocalStorage(sessionIdOf(f, 'Worktree session')) })
    await expect.poll(() => fake.callsTo('libraryState').length).toBeGreaterThan(0)
    await stays(() => fake.callsTo('seedLibraryState').length === 0, 300, 'no seed from a remote window')
    expect(fake.state.library.seeded).toBe(false)
  })
})
