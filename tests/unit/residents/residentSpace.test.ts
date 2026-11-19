import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResidentMessage } from '@shared/domain/residents'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('the history file', () => {
  it('a history file without via or note reads as before, and one with them keeps them', () => {
    const root = mkdtempSync(join(tmpdir(), 'apiary-space-'))
    dirs.push(root)
    const old: ResidentMessage = { id: 'a', role: 'user', text: 'hi', at: 1, streaming: false }
    const space = new ResidentSpace(root, 'regent')
    space.saveHistory([old])
    expect(space.loadHistory()).toEqual([old])

    const messages: ResidentMessage[] = [
      { id: 'b', role: 'user', text: 'from slack', at: 2, streaming: false, via: 'slack' },
      { id: 'c', role: 'user', text: 'A session finished', at: 3, streaming: false, note: true },
    ]
    space.saveHistory(messages)
    expect(new ResidentSpace(root, 'regent').loadHistory()).toEqual(messages)
  })

  it('a message with an unknown via is dropped', () => {
    const root = mkdtempSync(join(tmpdir(), 'apiary-space-'))
    dirs.push(root)
    const space = new ResidentSpace(root, 'regent')
    space.saveHistory([{ id: 'x', role: 'user', text: 't', at: 1, streaming: false, via: 'sms' as never }])
    expect(new ResidentSpace(root, 'regent').loadHistory()).toEqual([])
  })
})
