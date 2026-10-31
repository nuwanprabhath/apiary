import { describe, it, expect } from 'vitest'
import { RESIDENT_KINDS, SESSION_LINK_PREFIX } from '@shared/domain/residents'
import { kindOf, newResident } from '../../../src/main/residents/kinds'

describe('the Regent kind', () => {
  it('names itself and teaches the links the renderer opens', () => {
    const prompt = kindOf('regent').systemPrompt('Ada')
    expect(prompt).toContain('You are Ada')
    expect(prompt).toContain(`[title](${SESSION_LINK_PREFIX}<id>)`)
    expect(prompt).toMatch(/find_sessions.*open_session.*note_put.*note_list/s)
  })

  it('a first Regent is `regent`, a second gets a fresh id, both switched off', () => {
    const first = newResident(kindOf('regent'), new Set())
    const second = newResident(kindOf('regent'), new Set([first.id]))
    expect(first).toMatchObject({ id: 'regent', name: 'Regent', enabled: false, model: 'sonnet', digestModel: 'haiku' })
    expect(second.id).not.toBe('regent')
    expect(second.enabled).toBe(false)
  })
})

describe('every kind', () => {
  it('gives each quick action and its cycle the words the pill shows while it runs, within the 40-character cut', () => {
    for (const id of RESIDENT_KINDS) {
      const kind = kindOf(id)
      const words = [...kind.quickActions.map((a) => a.doing), ...(kind.cycle === undefined ? [] : [kind.cycle.doing])]
      for (const doing of words) {
        expect(doing.trim()).not.toBe('')
        expect(doing.length).toBeLessThanOrEqual(40)
      }
    }
    expect(kindOf('mr-desk').quickActions.map((a) => [a.id, a.doing])).toEqual([
      ['desk', 'Reading the desk'], ['stats-week', "Counting last week's MRs"], ['stats-month', "Counting last month's MRs"],
      ['check-now', 'Checking your MRs'], ['baseline', 'Marking the backlog as seen'],
    ])
  })
})
