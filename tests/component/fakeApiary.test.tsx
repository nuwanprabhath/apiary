import { describe, it, expect } from 'vitest'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'
import { createFakeApiary, fakePet } from './fakeApiary'

/**
 * Two things the fake guarantees for every call, whatever it models (the rest is pinned by the
 * contract, tests/contract/): a call is handed to it as Electron's IPC would hand it to main, and
 * what it answers or pushes is a copy. Without them a component test passes against sharing that the
 * app does not have.
 */
describe('the fake bridge, as a bridge', () => {
  it('answers with copies: changing an answer does not change the fake', async () => {
    const fake = createFakeApiary()
    const pets = await fake.petsState()
    pets.enabled = true
    pets.pets.push(fakePet('stray'))
    expect(await fake.petsState()).toEqual({ enabled: false, pets: [], generating: false })
  })

  it('takes copies of what it is given: changing an argument afterwards changes nothing', async () => {
    const fake = createFakeApiary()
    const plugins: Record<string, boolean> = { somebody: false }
    await fake.settingsSet({ plugins } as never)
    plugins.somebody = true
    expect(fake.state.settings.plugins).toEqual({ somebody: false })
  })

  it('pushes a copy to every listener, so one window cannot change what another is told', () => {
    const fake = createFakeApiary()
    const heard: { id: string; size: number }[][] = []
    fake.onPetsChanged((state) => { state.pets[0].size = 1; heard.push(state.pets) })
    fake.onPetsChanged((state) => { heard.push(state.pets) })
    const pushed = { enabled: true, generating: false, pets: [fakePet('pip', { size: 64 })] }
    fake.emit('petsChanged', pushed)
    expect(heard.map((pets) => pets[0].size)).toEqual([1, 64])
    expect(pushed.pets[0].size).toBe(64)
  })

  it('refuses what an IPC could not carry: a function in an argument', () => {
    const fake = createFakeApiary()
    expect(() => fake.logWrite('info', 'ipc', 'a line', { callback: () => {} })).toThrow()
  })

  it('refuses a call whose arguments the contract\'s guard refuses: an invoke rejects, a send is dropped', async () => {
    const fake = createFakeApiary()
    await expect(fake.renameSession(STD.csv.id, 5 as never)).rejects.toThrow('Invalid request.')
    expect(fake.state.sessions.find((s) => s.sessionId === STD.csv.id)?.title).toBe(STD.csv.title)
    fake.reportTabs('everything' as never)
    expect(fake.state.tabs).toEqual([])
    // ...but the call is still on record, so a test can see what the renderer tried.
    expect(fake.callsTo('renameSession')).toEqual([[STD.csv.id, 5]])
  })

  it('lets a subscription keep its callback', () => {
    const fake = createFakeApiary()
    let heard = 0
    const off = fake.onTreeChanged(() => { heard += 1 })
    fake.emit('treeChanged')
    off()
    fake.emit('treeChanged')
    expect(heard).toBe(1)
  })
})
