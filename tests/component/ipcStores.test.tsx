import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { fakePet } from './fakeApiary'
import { sidebarSession, until } from './helpers'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { PetsState } from '@shared/pets/state'

/**
 * The renderer reads what main pushes through `state/createIpcStore.ts` (the generic ordering is in
 * tests/unit/createIpcStore.test.ts). These are the two defects that motivated it, seen from the
 * app: an old initial fetch landing on top of a newer push, and one subscription and one read per
 * caller instead of per thing read.
 */
describe('IPC stores', () => {
  it('a pets push that lands before the initial pets read resolves is not overwritten by it', async () => {
    let release: (state: PetsState) => void = () => {}
    const { fake } = await renderApp({}, (f) => {
      // The read main answered before the push — slow, and about to land late.
      f.override('petsState', () => new Promise<PetsState>((resolve) => { release = resolve }))
    })
    const pushed: PetsState = { enabled: true, generating: false, pets: [fakePet('pip', { size: 64 })] }
    fake.state.pets = pushed
    fake.emit('petsChanged', pushed)
    await expect.element(page.getByTestId('pet')).toBeVisible()

    release({ enabled: false, generating: false, pets: [] })
    // The stale answer is dropped: the pet is still out, and stays out.
    await until(() => fake.callsTo('petsState').length === 1)
    await userEvent.keyboard('{Shift}') // a real round trip to the browser: the stale answer has been handled by now
    expect(document.querySelector('[data-testid="pet"]')).not.toBeNull()
  })

  it('two panes on the same chat share one chatState read and one chat subscription', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    const sessionId = fake.state.sessions.find((s) => s.title === 'Fix CSV export bug')!.sessionId
    // The pane's header and its body both read this chat: still one read.
    expect(fake.callsTo('chatState').filter((a) => a[0] === sessionId)).toHaveLength(1)

    // A second pane on the same session reads the same store, so it asks nothing more.
    await userEvent.click(page.getByTestId('session-tab-split'))
    await until(() => document.querySelectorAll('[data-testid="chat-timeline"]').length === 2)
    expect(fake.callsTo('chatState').filter((a) => a[0] === sessionId)).toHaveLength(1)

    // And a push for it reaches both.
    const next = { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }
    fake.state.chats.set(sessionId, next)
    fake.emit('chatChanged', next)
    await until(() => document.querySelectorAll('[data-testid="composer-input"]').length === 2)
  })
})
