/**
 * UI-10: `mrStatusStore` replaces one `setInterval` plus one `onMrStatusesInvalidated` listener per
 * mounted `useMrStatuses` call with a single shared one, and unions whatever every mounted consumer
 * for a session is asking about into one `gitlabMrRefStatus` request per tick — instead of a
 * title's and a note's call for the same session going out separately, which is what `SessionRow`
 * calling the hook twice used to cost.
 */
import { describe, it, expect } from 'vitest'
import { renderApp } from './renderApp'
import { stays, until } from './helpers'
import { asSessionId } from '@shared/domain/ids'
import { subscribeMrStatuses, currentMrStatuses } from '../../src/renderer/state/mrStatusStore'

const S1 = asSessionId('s1')

describe('mrStatusStore', () => {
  it('unions two consumers subscribing to the same session in one tick into a single request', async () => {
    const { fake } = await renderApp()
    const calls: number[][] = []
    fake.override('gitlabMrRefStatus', async (_terminal, iids) => {
      calls.push(iids)
      return {}
    })

    // A title's and a note's subscribe for the same session, as SessionRow issues them in the
    // same render.
    const offTitle = subscribeMrStatuses(S1, [101], () => {})
    const offNote = subscribeMrStatuses(S1, [102], () => {})

    await until(() => calls.length >= 1)
    // Give any second, wrongly-separate request a chance to have landed too.
    await stays(() => calls.length === 1, 50, 'one request for two subscribers')

    expect([...calls[0]].sort()).toEqual([101, 102])

    offTitle()
    offNote()
  })

  it('delivers the result to every subscriber for that session', async () => {
    const { fake } = await renderApp()
    fake.override('gitlabMrRefStatus', async () => ({ 101: 'merged' }))
    let received: unknown
    const off = subscribeMrStatuses(S1, [101], (statuses) => { received = statuses })

    await until(() => received !== undefined)
    expect(received).toEqual({ 101: 'merged' })
    expect(currentMrStatuses(S1)).toEqual({ 101: 'merged' })

    off()
  })

  it('re-fetches on invalidation exactly once for a session with several mounted consumers', async () => {
    const { fake } = await renderApp()
    let calls = 0
    fake.override('gitlabMrRefStatus', async () => { calls++; return {} })

    const offA = subscribeMrStatuses(S1, [101], () => {})
    const offB = subscribeMrStatuses(S1, [102], () => {})
    await until(() => calls >= 1)
    const before = calls

    fake.emit('mrStatusesInvalidated')
    await until(() => calls > before)
    await stays(() => calls === before + 1, 50, 'one re-fetch per invalidation')

    offA()
    offB()
  })
})
