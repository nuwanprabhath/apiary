import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { nextFrames, sidebarSession } from './helpers'
import { chatPush } from '@shared/chatPush'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { FakeApiary } from './fakeApiary'

/**
 * A second view of one chat (a remote window's copy, over a link slower than the chat's pushes,
 * one every ~120 ms) that misses a push must catch up while Claude is still writing. It used to refetch on
 * every delta it could not apply, each fetch superseding the last, so none landed until the stream
 * paused: the view sat on an old state, its clock still ticking.
 */
const TITLE = 'Fix CSV export bug'
/** A `chatState` answer lands this many pushes after it was asked for: a round trip longer than a push interval. */
const ROUND_TRIP_PUSHES = 8

const streamed = (): string => document.querySelector('[data-testid="chat-streaming"]')?.textContent ?? ''

/** Main's side of the stream: each state diffed against the one pushed before, and whole to a window
 *  that attached since its last push (`ChatService.onChanged`). */
function mainStream(fake: FakeApiary, start: ChatState, afterEachPush: () => void): (patch: Partial<ChatState>) => ChatState {
  let pushed = start
  let attachesSeen = fake.callsTo('chatAttach').length
  return (patch) => {
    afterEachPush()
    const next = { ...pushed, ...patch, seq: pushed.seq + 1 }
    fake.state.chats.set(next.sessionId, next)
    const attaches = fake.callsTo('chatAttach').length
    fake.emit('chatChanged', attaches > attachesSeen ? { kind: 'full', state: next } : chatPush(pushed, next))
    attachesSeen = attaches
    pushed = next
    return next
  }
}

describe('a chat view that fell behind', () => {
  it('catches up while the chat keeps streaming faster than one chatState round trip', async () => {
    const { fake } = await renderApp({ settings: { transcriptChat: true } })
    const sessionId = asSessionId(fake.state.sessions.find((s) => s.title === TITLE)!.sessionId)
    const busy: ChatState = {
      ...emptyChatState(sessionId), status: 'busy', seq: 10, turnStartedAt: Date.now(),
      streaming: { text: 'word 0', thinking: false, thinkingSince: null, thinkingTokens: null },
    }
    fake.state.chats.set(sessionId, busy)
    await userEvent.click(sidebarSession(TITLE))
    await expect.element(page.getByTestId('chat-streaming')).toHaveTextContent('word 0')

    const inFlight: { due: number; land: () => void }[] = []
    let pushes = 0
    fake.override('chatState', (id) => {
      const answer = fake.state.chats.get(id) ?? null
      return new Promise((resolve) => { inFlight.push({ due: pushes + ROUND_TRIP_PUSHES, land: () => { resolve(answer) } }) })
    })
    const tick = (): void => {
      pushes += 1
      for (const f of inFlight.filter((x) => x.due <= pushes)) { inFlight.splice(inFlight.indexOf(f), 1); f.land() }
    }
    // One push never reaches this window: every delta after it is computed onto a state it lacks.
    const lost = { ...busy, seq: busy.seq + 1, streaming: { ...busy.streaming!, text: 'word 1' } }
    fake.state.chats.set(sessionId, lost)
    const send = mainStream(fake, lost, tick)

    let caughtUp = false
    for (let n = 2; n < 60 && !caughtUp; n++) {
      send({ streaming: { ...busy.streaming!, text: `word ${String(n)}` } })
      // About one push interval (two frames), then: does the view show one of the last few pushes?
      // (A stuck view stays on `word 0`; streamed text is drawn a frame or so behind.)
      await nextFrames(2)
      const shown = Number(/word (\d+)/.exec(streamed())?.[1] ?? -1)
      caughtUp = shown >= 2 && shown >= n - 3
    }
    expect(caughtUp).toBe(true)
  })
})
