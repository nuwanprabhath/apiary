import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { createFakeApiary, type FakeApiary } from './fakeApiary'
import { until } from './helpers'
import { useResident } from '../../src/renderer/state/residentsStore'
import { answerPermission, markResidentSeen, runQuickAction } from '../../src/renderer/state/residentChat'
import { addResident, pickResidentFolder, useResidentKinds } from '../../src/renderer/state/residentSettings'
import { residentStatuses } from './fake/residents'

/**
 * What package G draws from: a status push carries the permission requests, the attention and the
 * kind's quick actions, and the commands answer, clear and run them; the kinds store lists every kind.
 */
let root: Root | null = null
afterEach(() => { root?.unmount(); root = null; document.body.replaceChildren() })

function Probe() {
  const one = useResident('regent')
  const kinds = useResidentKinds()
  const permissions = one?.permissions.map((p) => `${p.requestId}=${p.summary}`).join(',') ?? ''
  const attention = one?.attention === null || one === null ? 'none' : `${String(one.attention.count)}:${one.attention.summary}`
  const actions = one?.quickActions.map((a) => a.label).join(',') ?? ''
  return <p data-testid="probe">{permissions}|{attention}|{actions}|{kinds.map((k) => k.defaultName).join(',')}</p>
}

function mount(): FakeApiary {
  const fake = createFakeApiary()
  window.apiary = fake
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(<Probe />)
  return fake
}

const text = (): string => document.querySelector('[data-testid="probe"]')?.textContent ?? ''

describe('resident status in the store', () => {
  it('reflects permissions, attention and quick actions from a push, and the commands clear them', async () => {
    const fake = mount()
    await addResident('regent')
    await until(() => text() === '|none||Regent,MR Desk')
    fake.state.residentPermissions.set('regent', [{ requestId: 'r1', tool: 'Bash', summary: 'Run: glab mr list' }])
    const pushed = residentStatuses(fake.state).map((s) => ({ ...s, quickActions: [{ id: 'desk', label: 'Get the desk' }] }))
    fake.emit('residentsChanged', pushed)
    await until(() => text() === 'r1=Run: glab mr list|1:Waiting for your OK|Get the desk|Regent,MR Desk')

    answerPermission('regent', 'r1', true)
    await until(() => text() === '|none||Regent,MR Desk')
    expect(fake.callsTo('residentPermissionAnswer')).toEqual([['regent', 'r1', true]])

    fake.state.residentAttention.set('regent', { count: 2, summary: 'MRs waiting' })
    fake.emit('residentsChanged', residentStatuses(fake.state))
    await until(() => text() === '|2:MRs waiting||Regent,MR Desk')
    markResidentSeen('regent')
    await until(() => text() === '|none||Regent,MR Desk')
  })

  it('an unknown quick action and a non-folder option are refused', async () => {
    const fake = mount()
    await addResident('regent')
    runQuickAction('regent', 'nope')
    await until(() => fake.callsTo('residentQuickAction').length === 1)
    await expect(pickResidentFolder('regent', 'clone')).rejects.toThrow(/no folder option/)
  })
})
