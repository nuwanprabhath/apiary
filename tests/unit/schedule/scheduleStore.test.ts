import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScheduleStore } from '../../../src/main/schedule/scheduleStore'

const ID = '0b9c2f4e-5d6a-4b7c-8d9e-0f1a2b3c4d5e'
const OTHER = '1c0d3e5f-6e7b-4c8d-9e0f-1a2b3c4d5e6f'

/** A `scheduled-messages.json` holding `content`, read back the way Apiary reads it at start. */
function load(content: unknown): ReturnType<ReturnType<typeof createScheduleStore>['load']> {
  const file = join(mkdtempSync(join(tmpdir(), 'schedule-store-')), 'scheduled-messages.json')
  writeFileSync(file, JSON.stringify(content))
  return createScheduleStore(file).load()
}

describe('the scheduled-messages file', () => {
  it('reads back a schedule and a notice with every field', () => {
    const got = load({
      version: 1,
      messages: [{ id: ID, sessionId: 's1', text: 'continue', at: 2000, createdAt: 1000, account: 'work', missed: true }],
      notices: [{ id: OTHER, sessionId: 's1', text: 'continue', at: 3000, ok: false, whileClosed: true, detail: 'claude: not found' }],
    })
    expect(got.messages).toEqual([{ id: ID, sessionId: 's1', text: 'continue', at: 2000, createdAt: 1000, account: 'work', missed: true }])
    expect(got.notices).toEqual([{ id: OTHER, sessionId: 's1', text: 'continue', at: 3000, ok: false, whileClosed: true, detail: 'claude: not found' }])
  })

  it('leaves out optional fields that are absent, and reads a notice without them as sent while open', () => {
    const got = load({
      version: 1,
      messages: [{ id: ID, sessionId: 's1', text: 'continue', at: 2000, createdAt: 1000, missed: 'yes' }],
      notices: [{ id: OTHER, sessionId: 's1', text: 'continue', at: 3000, ok: true }],
    })
    expect(got.messages).toEqual([{ id: ID, sessionId: 's1', text: 'continue', at: 2000, createdAt: 1000 }])
    expect(got.notices).toEqual([{ id: OTHER, sessionId: 's1', text: 'continue', at: 3000, ok: true, whileClosed: false, detail: null }])
  })

  it('drops each entry that is not a whole schedule or notice, keeping the good ones', () => {
    const good = { id: ID, sessionId: 's1', text: 'continue', at: 2000, createdAt: 1000 }
    const got = load({
      version: 1,
      messages: [good, null, 'x', { ...good, id: 'not-a-uuid' }, { ...good, sessionId: 4 }, { ...good, text: null },
        { ...good, at: Number.NaN }, { ...good, at: 'soon' }, { ...good, createdAt: undefined }],
      notices: [{ id: OTHER, sessionId: 's1', text: 'continue', at: 3000, ok: 'yes' }, 7],
    })
    expect(got.messages).toEqual([good])
    expect(got.notices).toEqual([])
  })

  it('reads lists that are not arrays, or a file that is not an object, as nothing scheduled', () => {
    expect(load({ version: 1, messages: 'none', notices: {} })).toMatchObject({ messages: [], notices: [] })
    expect(load([1, 2])).toMatchObject({ messages: [], notices: [] })
  })

  it('reads a missing file as nothing scheduled', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'schedule-store-')), 'scheduled-messages.json')
    expect(createScheduleStore(file).load()).toMatchObject({ messages: [], notices: [] })
  })
})
