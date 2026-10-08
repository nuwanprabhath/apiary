import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderApp } from './renderApp'
import { latestClaudeAction, onPetVoiceCheck, watchClaudeActions } from '../../src/renderer/state/petsStore'

/**
 * What the pets know of Claude's work, and the one timer behind their hourly voice check, live in
 * `state/petsStore.ts`. Main pushes every change of the tabs; nothing polls.
 */
const TAB = { windowNumber: 1, key: 'k1', view: 'transcript', status: 'running', label: null } as const

describe('claude actions for the pets', () => {
  afterEach(() => { vi.useRealTimers() })

  it('follow main\'s pushes, and cost no read while nothing is pushed', async () => {
    const { fake } = await renderApp()
    fake.state.tabs = [TAB]
    fake.state.pets = { ...fake.state.pets, enabled: true }
    fake.state.petActions = { k1: 'Edit: first.ts' }
    const stop = watchClaudeActions()
    await expect.poll(latestClaudeAction).toBe('Edit: first.ts')
    expect(fake.callsTo('petClaudeActions')).toHaveLength(1)

    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(fake.callsTo('petClaudeActions')).toHaveLength(1)

    fake.state.petActions = { k1: 'Bash: Run the tests' }
    fake.emit('activeTabsChanged')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(latestClaudeAction()).toBe('Bash: Run the tests')
    stop()
  })

  it('a burst of pushes is read once a couple of seconds, not once per push', async () => {
    const { fake } = await renderApp()
    fake.state.tabs = [TAB]
    fake.state.pets = { ...fake.state.pets, enabled: true }
    fake.state.petActions = { k1: 'Edit: first.ts' }
    const stop = watchClaudeActions()
    await expect.poll(() => fake.callsTo('petClaudeActions').length).toBe(1)

    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(5_000)
    for (let i = 0; i < 20; i++) { fake.emit('activeTabsChanged'); fake.emit('treeChanged') }
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fake.callsTo('petClaudeActions').length).toBeLessThanOrEqual(3)
    stop()
  })

  it('know of nothing once no session is running, without asking main', async () => {
    const { fake } = await renderApp()
    fake.state.tabs = [TAB]
    fake.state.pets = { ...fake.state.pets, enabled: true }
    fake.state.petActions = { k1: 'Edit: first.ts' }
    const stop = watchClaudeActions()
    await expect.poll(latestClaudeAction).toBe('Edit: first.ts')
    const asked = fake.callsTo('petClaudeActions').length

    fake.state.tabs = [{ ...TAB, status: 'idle' }]
    fake.emit('activeTabsChanged')
    await expect.poll(latestClaudeAction, { timeout: 5_000 }).toBeUndefined()
    expect(fake.callsTo('petClaudeActions')).toHaveLength(asked)
    stop()
  })
})

describe('the pets\' voice check', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('shares one timer however many listen, and stops when the last leaves', () => {
    vi.useFakeTimers()
    const setInterval = vi.spyOn(window, 'setInterval')
    const a = vi.fn()
    const b = vi.fn()
    const offA = onPetVoiceCheck(a)
    const offB = onPetVoiceCheck(b)
    expect(setInterval).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(30_000)
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1])
    vi.advanceTimersByTime(10 * 60_000)
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 2])

    offA()
    vi.advanceTimersByTime(10 * 60_000)
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 3])
    offB()
    expect(vi.getTimerCount()).toBe(0)
  })
})
