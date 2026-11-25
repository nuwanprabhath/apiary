import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountId } from '@shared/domain/ids'
import { Digester } from '../../../src/main/knowledge/digester'
import { KnowledgeStore } from '../../../src/main/knowledge/knowledgeStore'

const line = (role: string, text: string): string => JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } })

function build(lines: string[], gateAllows: () => boolean, onRun: () => void): { digester: Digester } {
  const dir = mkdtempSync(join(tmpdir(), 'apiary-dg-'))
  const file = join(dir, 's.jsonl')
  writeFileSync(file, `${lines.join('\n')}\n`)
  const holder: { digester: Digester } = { digester: undefined as unknown as Digester }
  holder.digester = new Digester({
    store: new KnowledgeStore(join(dir, 'k.db')),
    sessions: () => [{ sessionId: 's', file, cwd: '/w', lastActive: 1, accountId: 'main' as AccountId }],
    runner: { run: async () => { onRun(); return JSON.stringify({ structured_output: { topics: [] } }) } },
    accounts: { launchEnv: () => ({}) },
    residentsDir: join(dir, 'residents'),
    gateAllows,
    wait: async () => { holder.digester.pause() },
  })
  return holder
}

describe('Digester privacy gate', () => {
  it('sends no further window once the gate closes mid-pass', async () => {
    let open = true
    let calls = 0
    const lines = Array.from({ length: 6 }, (_, i) => line(i % 2 === 1 ? 'assistant' : 'user', 'x'.repeat(30_000)))
    const { digester } = build(lines, () => open, () => { calls += 1; open = false })
    digester.resume({ model: 'haiku', lookback: null, shouldPause: () => false })
    await digester.idle()
    expect(calls).toBe(1)
  })

  it('treats a gate that throws as closed', async () => {
    let calls = 0
    const { digester } = build([line('user', 'hi')], () => { throw new Error('boom') }, () => { calls += 1 })
    digester.resume({ model: 'haiku', lookback: null, shouldPause: () => false })
    await digester.idle()
    expect(calls).toBe(0)
  })
})
