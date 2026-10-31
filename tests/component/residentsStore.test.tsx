import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { createFakeApiary, type FakeApiary } from './fakeApiary'
import { until } from './helpers'
import { useResident, useResidents, useResidentsLoaded } from '../../src/renderer/state/residentsStore'
import {
  clearResident, redigestResident, sendToResident, stopResident, upsertMessage, useResidentHistory, useResidentHistoryLoaded,
} from '../../src/renderer/state/residentChat'
import { addResident, updateResident } from '../../src/renderer/state/residentSettings'

/**
 * The residents API package D renders: statuses follow `residentsChanged`, a resident's chat is
 * read once and then follows `residentMessage` (a streamed answer updates one message in place),
 * and the settings commands go through main's settings write.
 */
let root: Root | null = null
afterEach(() => { root?.unmount(); root = null; document.body.replaceChildren() })

function Probe({ id }: { id: string }) {
  const residents = useResidents()
  const history = useResidentHistory(id)
  const one = useResident(id)
  const loaded = `${String(useResidentsLoaded())},${String(useResidentHistoryLoaded(id))}`
  return (
    <>
      <p data-testid="probe">{residents.map((r) => `${r.name}:${r.state}`).join(',')}|{history.map((m) => `${m.role}=${m.text}`).join(';')}</p>
      <p data-testid="one">{one?.name ?? 'none'}</p>
      <p data-testid="loaded">{loaded}</p>
    </>
  )
}

function mount(id: string): FakeApiary {
  const fake = createFakeApiary()
  window.apiary = fake
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(<Probe id={id} />)
  return fake
}

const byId = (id: string): string => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
const text = (): string => byId('probe')

describe('residents store and commands', () => {
  it('an added, renamed and enabled resident is listed, and its streamed answer is one message', async () => {
    const fake = mount('regent')
    await until(() => text() === '|')
    expect(byId('one')).toBe('none')
    const added = await addResident('regent')
    expect(added.id).toBe('regent')
    await updateResident('regent', { name: 'Ada', enabled: true })
    await until(() => text().startsWith('Ada:'))
    expect(await sendToResident('regent', 'hello')).toEqual([])
    await until(() => text().endsWith('user=hello;assistant=You said: hello'))
    expect(byId('one')).toBe('Ada')
    expect(byId('loaded')).toBe('true,true')
    stopResident('regent')
    redigestResident('regent')
    await until(() => fake.callsTo('residentStop').length === 1 && fake.callsTo('residentRedigest').length === 1)
    clearResident('regent')
    await until(() => text().endsWith('|'))
    expect(text()).toMatch(/^Ada:/)
  })

  it('an unknown resident cannot be updated', async () => {
    mount('nobody')
    await expect(updateResident('nobody', { name: 'X' })).rejects.toThrow('No resident nobody')
  })

  it('upsertMessage replaces by id and appends a new one', () => {
    const a = { id: 'a', role: 'assistant' as const, text: 'x', at: 1, streaming: true }
    expect(upsertMessage([a], { ...a, text: 'xy', streaming: false })).toEqual([{ ...a, text: 'xy', streaming: false }])
    expect(upsertMessage([a], { ...a, id: 'b' })).toHaveLength(2)
  })
})
