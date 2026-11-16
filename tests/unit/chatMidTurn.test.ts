import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyChatState, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import type { TranscriptMessage } from '@shared/domain/transcript'
import { chatItems, mergeLive, stillQueued } from '@shared/chatTimeline'
import { parseLine, reduce, type Line } from '../../src/main/chat/protocol'
import { decodeEntry } from '../../src/main/transcript/claudeEntry'
import { entryMessage } from '../../src/main/transcript/transcriptReader'

/**
 * A message sent while Claude works, recorded from a real `claude` 2.1.325 (Haiku) driven as chat
 * mode drives it: `<name>.stdout.jsonl` is what it printed (stream events left out), and
 * `<name>.session.jsonl` the session file's messages. Its `queued_command` carries the new
 * `delivery_id`, `commandMode` and `hostsOwnTurn` fields.
 */
const FIXTURES = join(__dirname, '../fixtures/chat')
const stdout = (name: string): Line[] =>
  readFileSync(join(FIXTURES, `${name}.stdout.jsonl`), 'utf8').split('\n').flatMap((l) => { const e = parseLine(l); return e === null ? [] : [e] })
const sessionFile = (name: string): TranscriptMessage[] =>
  readFileSync(join(FIXTURES, `${name}.session.jsonl`), 'utf8').split('\n').flatMap((l) => {
    const entry = l === '' ? null : decodeEntry(l)
    const m = entry === null ? null : entryMessage(entry)
    return m === null ? [] : [m]
  })

const SECOND = 'Also, what is the capital of France? Answer that too.'
const textOf = (m: TranscriptMessage): string => m.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')

/** How many times the conversation shows `text`: as a message of yours, plus as a queued row. */
function shown(state: ChatState, file: TranscriptMessage[], text: string): number {
  const merged = mergeLive(file, state.live)
  const bubbles = chatItems(merged).filter((i) => i.kind === 'user' && i.text === text).length
  return bubbles + stillQueued(state.queued, merged).filter((q) => q.text === text).length
}

/** The chat after sending `text` at `sentAt`, as `ChatSession.send` records it. */
const sent = (state: ChatState, text: string, sentAt: number): ChatState =>
  ({ ...state, queued: [...state.queued, { id: `q${String(state.queued.length)}`, text, sentAt }] })

const BUSY: ChatState = { ...emptyChatState(asSessionId('s')), status: 'busy' }

describe('a message sent mid-turn (claude 2.1.325)', () => {
  const lines = stdout('mid-turn-2.1.325')
  const file = sessionFile('mid-turn-2.1.325')
  const replay = lines.find((l) => l.isReplay === true && JSON.stringify(l).includes(SECOND))!
  const sentAt = Date.parse(String(replay.timestamp)) - 5

  it('records it once in the file, under the uuid the stream replays it with', () => {
    const copies = file.filter((m) => textOf(m) === SECOND)
    expect(copies.map((m) => m.uuid)).toEqual([replay.uuid])
  })

  it('shows once in every phase: queued, replayed, and once the file has it', () => {
    const sendAfter = lines.findIndex((l) => l.type === 'assistant' && JSON.stringify(l).includes('tool_use'))
    // Claude writes the file before it replays, so the file's copy arrives while it is still queued.
    const fileWithIt = file.slice(0, file.findIndex((m) => textOf(m) === SECOND) + 1)
    const replayAt = lines.indexOf(replay)
    let state = BUSY
    let queuedOnly = BUSY
    const counts: number[] = []
    lines.forEach((line, i) => {
      if (i === replayAt) queuedOnly = state
      counts.push(shown(state, i >= replayAt ? fileWithIt : [], SECOND))
      state = reduce(state, line)
      if (i === sendAfter) state = sent(state, SECOND, sentAt)
    })
    expect(counts).toEqual(lines.map((_, i) => (i > sendAfter ? 1 : 0)))
    expect(shown(queuedOnly, [], SECOND)).toBe(1)
    expect(state.queued).toEqual([])
    expect(shown(state, [], SECOND)).toBe(1)
    expect(shown(state, file, SECOND)).toBe(1)
  })

  it('shows once when the replay comes under another uuid than the file\'s queued_command', () => {
    const state = lines.map((l) => (l === replay ? { ...replay, uuid: 'another-uuid' } : l)).reduce(reduce, sent(BUSY, SECOND, sentAt))
    expect(shown(state, file, SECOND)).toBe(1)
    // The file part a window holds may end before the replay's place: still once.
    expect(shown(state, file.slice(0, file.findIndex((m) => textOf(m) === SECOND) + 1), SECOND)).toBe(1)
  })

  it('shows once when the message comes back without isReplay', () => {
    const { isReplay: _flag, ...unflagged } = replay
    const state = reduce(sent(BUSY, SECOND, sentAt), unflagged)
    expect(state.queued).toEqual([])
    expect(shown(state, [], SECOND)).toBe(1)
  })

})

describe('the same text sent three times mid-turn (claude 2.1.325)', () => {
  it('shows three times, though two of them share a millisecond', () => {
    const lines = stdout('three-sends-2.1.325')
    const file = sessionFile('three-sends-2.1.325')
    const replays = lines.filter((l) => l.isReplay === true && JSON.stringify(l).includes(SECOND))
    expect(replays).toHaveLength(3)
    let state = BUSY
    for (const r of replays) state = sent(state, SECOND, Date.parse(String(r.timestamp)) - 5)
    for (const line of lines) state = reduce(state, line)
    expect(shown(state, file, SECOND)).toBe(3)
    expect(shown(state, [], SECOND)).toBe(3)
    expect(shown({ ...state, live: [] }, file, SECOND)).toBe(3)
  })
})
