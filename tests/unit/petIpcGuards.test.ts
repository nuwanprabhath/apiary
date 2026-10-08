import { describe, it, expect } from 'vitest'
import { IPC } from '@shared/ipc/contract'
import { isPetPatch, isVoiceContext, limitVoiceContext, pickPetPatch } from '@shared/pets/ipcGuards'

/** The guards the contract holds for `petUpdate` and `petVoice`, so those handlers get typed values. */
describe('isPetPatch', () => {
  it('accepts any subset of the editable fields, including an empty patch', () => {
    expect(isPetPatch({})).toBe(true)
    expect(isPetPatch({ name: 'Pip' })).toBe(true)
    expect(isPetPatch({ model: 'haiku', size: 92, active: false })).toBe(true)
    expect(isPetPatch({ place: null })).toBe(true)
    expect(isPetPatch({ place: { region: 'rail', at: 0.5 } })).toBe(true)
  })

  it('rejects a field of the wrong kind', () => {
    expect(isPetPatch({ name: 3 })).toBe(false)
    expect(isPetPatch({ model: 'gpt' })).toBe(false)
    expect(isPetPatch({ size: Number.NaN })).toBe(false)
    expect(isPetPatch({ size: '64' })).toBe(false)
    expect(isPetPatch({ active: 'yes' })).toBe(false)
    expect(isPetPatch({ place: { region: 'sky', at: 1 } })).toBe(false)
    expect(isPetPatch({ place: { region: 'bar' } })).toBe(false)
  })

  it('rejects what is not an object', () => {
    for (const v of [null, undefined, 'name', 7, ['name']]) expect(isPetPatch(v)).toBe(false)
  })
})

describe('pickPetPatch', () => {
  it('keeps the known fields and drops anything else a renderer attached', () => {
    const sent = { name: 'Pip', size: 80, id: 'other', spec: { evil: true }, createdAt: 1 }
    expect(pickPetPatch(sent as Parameters<typeof pickPetPatch>[0])).toEqual({ name: 'Pip', size: 80 })
  })

  it('keeps an explicit null place (put away) and leaves an absent one absent', () => {
    expect(pickPetPatch({ place: null })).toEqual({ place: null })
    expect('place' in pickPetPatch({ name: 'a' })).toBe(false)
  })
})

describe('isVoiceContext', () => {
  const ok = { working: 1, waiting: 0, finished: 2, titles: ['fix csv'], hour: 14 }

  it('accepts a well-formed context', () => {
    expect(isVoiceContext(ok)).toBe(true)
    expect(isVoiceContext({ ...ok, titles: [] })).toBe(true)
  })

  it('rejects a missing, non-finite or mistyped field', () => {
    expect(isVoiceContext({ ...ok, working: undefined })).toBe(false)
    expect(isVoiceContext({ ...ok, waiting: '0' })).toBe(false)
    expect(isVoiceContext({ ...ok, finished: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isVoiceContext({ ...ok, hour: Number.NaN })).toBe(false)
    expect(isVoiceContext({ ...ok, titles: 'fix csv' })).toBe(false)
    expect(isVoiceContext({ ...ok, titles: ['a', 3] })).toBe(false)
    expect(isVoiceContext(null)).toBe(false)
  })
})

describe('limitVoiceContext', () => {
  it('limits counts to 0-99, the hour to 0-23 and the titles to 8', () => {
    const limited = limitVoiceContext({
      working: 500, waiting: -3, finished: 2.6, hour: 31.9,
      titles: Array.from({ length: 12 }, (_, i) => `t${String(i)}`),
    })
    expect(limited).toEqual({ working: 99, waiting: 0, finished: 3, hour: 23, titles: ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] })
    expect(limitVoiceContext({ working: 1, waiting: 1, finished: 1, hour: -4, titles: [] }).hour).toBe(0)
  })
})

describe('the contract uses them', () => {
  it('rejects a malformed petUpdate and petVoice call before a handler runs', () => {
    expect(IPC.petUpdate.args(['pip', { size: 92 }])).toBe(true)
    expect(IPC.petUpdate.args(['pip', { size: '92' }])).toBe(false)
    expect(IPC.petUpdate.args(['pip'])).toBe(false)
    expect(IPC.petVoice.args(['pip', { working: 1, waiting: 0, finished: 0, titles: [], hour: 9 }])).toBe(true)
    expect(IPC.petVoice.args(['pip', {}])).toBe(false)
  })
})
