import { describe, expect, it, vi } from 'vitest'
import type { ResidentConfig } from '@shared/domain/residents'
import { CYCLE_ACTION_ID } from '@shared/domain/residents'
import type { RunCommand } from '../../../src/main/residents/residentService'
import { FRIDAY, build, regent } from './support'

const desk = (over: Partial<ResidentConfig> = {}): ResidentConfig => regent({ id: 'desk', kind: 'mr-desk', name: 'MR Desk', ...over })

/** A command runner whose runs wait until the test settles them, in the order they started. */
function heldRunner(): { run: RunCommand; held: { argv: string[]; release: (out: string) => void; fail: (e: Error) => void }[] } {
  const held: { argv: string[]; release: (out: string) => void; fail: (e: Error) => void }[] = []
  const run: RunCommand = (argv) => new Promise<string>((resolve, reject) => { held.push({ argv, release: resolve, fail: reject }) })
  return { run, held }
}

function deskService(run: RunCommand, config = desk()) {
  return build([config], { kinds: { setup: () => null, prepare: undefined }, run })
}

describe('a quick action shows that it is happening', () => {
  it('while a command is held the resident is working with its words, and the chat names what was asked', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { run, held } = heldRunner()
    const { service } = deskService(run)
    service.start()
    const done = service.quickAction('desk', 'desk')
    expect(service.list()[0]).toMatchObject({ state: 'working', activity: 'Reading the desk' })
    await vi.waitFor(() => { expect(held).toHaveLength(1) })
    expect(service.list()[0]).toMatchObject({ state: 'working', activity: 'Reading the desk' })
    expect(service.history('desk').map((m) => [m.role, m.text, m.action])).toEqual([['user', 'Show the desk', true]])

    held[0].release('| MR | state |\n')
    await done
    expect(service.history('desk').map((m) => [m.role, m.text])).toEqual([['user', 'Show the desk'], ['assistant', '| MR | state |']])
    expect(service.list()[0]).toMatchObject({ state: 'idle', activity: null })
  })

  it('a failing command ends idle, with the error in the chat', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { run, held } = heldRunner()
    const { service } = deskService(run)
    service.start()
    const done = service.quickAction('desk', 'stats-week')
    await vi.waitFor(() => { expect(held).toHaveLength(1) })
    expect(service.list()[0].activity).toBe("Counting last week's MRs")
    held[0].fail(new Error('glab: 401 Unauthorized'))
    await done
    expect(service.history('desk').at(-1)?.text).toBe('**Stats: last week** failed: glab: 401 Unauthorized')
    expect(service.list()[0]).toMatchObject({ state: 'idle', activity: null })
  })

  it('two overlapping actions keep it working until both end; the newest one speaks', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { run, held } = heldRunner()
    const { service } = deskService(run)
    service.start()
    const first = service.quickAction('desk', 'desk')
    const second = service.quickAction('desk', 'stats-month')
    await vi.waitFor(() => { expect(held).toHaveLength(2) })
    expect(service.list()[0].activity).toBe("Counting last month's MRs")
    held[1].release('stats')
    await second
    expect(service.list()[0]).toMatchObject({ state: 'working', activity: 'Reading the desk' })
    held[0].release('desk')
    await first
    expect(service.list()[0]).toMatchObject({ state: 'idle', activity: null })
  })

  it('a prompt action and Check now say their words until the model says what it does', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { run } = heldRunner()
    const { service } = deskService(run)
    service.start()
    await service.quickAction('desk', 'baseline')
    expect(service.list()[0]).toMatchObject({ state: 'working', activity: 'Marking the backlog as seen' })
    const other = deskService(run, desk({ id: 'desk2' })).service
    other.start()
    await other.quickAction('desk2', CYCLE_ACTION_ID)
    expect(other.list()[0]).toMatchObject({ state: 'working', activity: 'Checking your MRs' })
  })

  it('turning a resident on says "Starting" until its claude is up', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { run } = heldRunner()
    const { service, settings } = deskService(run, desk({ enabled: false }))
    service.start()
    expect(service.list()[0].state).toBe('asleep')
    settings.change([desk()])
    expect(service.list()[0]).toMatchObject({ state: 'working', activity: 'Starting' })
    await vi.waitFor(() => { expect(service.list()[0]).toMatchObject({ state: 'idle', activity: null }) })
  })
})
