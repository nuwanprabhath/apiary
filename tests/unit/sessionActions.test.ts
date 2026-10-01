import { describe, it, expect, vi } from 'vitest'
import { SessionActions } from '../../src/main/sessions/sessionActions'
import type { SessionActionsDeps } from '../../src/main/sessions/sessionActions'

function make(over: { live?: boolean; ptyHas?: boolean; known?: boolean } = {}) {
  const store = {
    setNote: vi.fn(), setCustomTitle: vi.fn(), setArchived: vi.fn(),
    getSession: vi.fn(() => ({ note: 'n' })),
    getProject: vi.fn(),
  }
  const requireSession = vi.fn((id: string) => {
    if (over.known === false) throw new Error(`Unknown session: ${id}`)
    return { sessionId: id, filePath: '/nonexistent/x.jsonl' }
  })
  const search = { putNoteIfEnabled: vi.fn() }
  const deps = {
    store, search,
    source: {},
    resolver: { requireSession },
    catalog: { isLive: () => over.live === true },
    pty: { has: () => over.ptyHas === true },
  } as unknown as SessionActionsDeps
  return { actions: new SessionActions(deps), store, search, requireSession }
}

describe('SessionActions', () => {
  it('rename trims, clears on blank, and validates the session first', async () => {
    const { actions, store } = make()
    await actions.renameSession('s', '  Hi ')
    expect(store.setCustomTitle).toHaveBeenCalledWith('s', 'Hi')
    await actions.renameSession('s', '   ')
    expect(store.setCustomTitle).toHaveBeenLastCalledWith('s', null)
    const bad = make({ known: false })
    await expect(bad.actions.renameSession('s', 'x')).rejects.toThrow('Unknown session')
    expect(bad.store.setCustomTitle).not.toHaveBeenCalled()
  })

  it('setSessionNote stores the trimmed note and keeps the search index in step', async () => {
    const { actions, store, search } = make()
    await actions.setSessionNote('s', ' a note ')
    expect(store.setNote).toHaveBeenCalledWith('s', 'a note')
    expect(search.putNoteIfEnabled).toHaveBeenCalledWith('s', 'a note')
    await actions.setSessionNote('s', ' ')
    expect(search.putNoteIfEnabled).toHaveBeenLastCalledWith('s', null)
  })

  it('refuses to remove a live session and archives an idle one', async () => {
    const live = make({ live: true })
    await expect(live.actions.removeSession('s')).rejects.toThrow('still running')
    expect(live.store.setArchived).not.toHaveBeenCalled()
    const idle = make()
    await idle.actions.removeSession('s')
    expect(idle.store.setArchived).toHaveBeenCalledWith('s', true)
  })

  it('refuses to move a session this process spawned even before a rescan saw it', async () => {
    const { actions } = make({ ptyHas: true })
    await expect(actions.moveSession('s', '/p')).rejects.toThrow('still running')
  })

  it('refuses to move a session the last scan saw running', async () => {
    const { actions } = make({ live: true })
    await expect(actions.moveSession('s', '/p')).rejects.toThrow('still running')
  })
})
