import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MR_DESK_KIND, REGENT_KIND } from '@shared/domain/residents'
import { validateResidentKindManifest, type ResidentKindManifest } from '@shared/residentKindManifest'
import { manifestKind, readManifestKinds } from '../../../src/main/residents/kinds/manifestKind'
import { KindRegistry, kindInfos, showDataKinds } from '../../../src/main/residents/kinds'

const RESERVED = new Set<string>([REGENT_KIND, MR_DESK_KIND])

const reasons = (raw: unknown): string[] => {
  const r = validateResidentKindManifest(raw, RESERVED)
  return r.ok ? [] : r.reasons
}

const valid = (raw: unknown): ResidentKindManifest => {
  const r = validateResidentKindManifest(raw, RESERVED)
  if (!r.ok) throw new Error(r.reasons.join('; '))
  return r.manifest
}

describe('validateResidentKindManifest', () => {
  it('is total: any input gives a manifest or reasons, never a throw', () => {
    const inputs: unknown[] = [null, undefined, 1, 'x', [], {}, { id: 5 }, { id: 'ok', name: {} },
      { id: 'ok', capabilities: 'all' }, { id: 'ok', cycle: { everyMinutes: 'x' } }, { id: 'ok', quickActions: [null] },
      Object.create(null), { id: 'ok', optionFields: [{ key: 1 }] }, { id: 'ok', toolPolicy: { disallowedTools: [1] } }]
    for (const raw of inputs) {
      const r = validateResidentKindManifest(raw, RESERVED)
      expect(r.ok ? ['ok'] : r.reasons).not.toHaveLength(0)
    }
    expect(validateResidentKindManifest(null, RESERVED).ok).toBe(false)
  })

  it('rejects an id that collides with a built-in, or is not a slug', () => {
    for (const id of [REGENT_KIND, MR_DESK_KIND]) {
      expect(reasons({ id, name: 'X' }).join()).toMatch(/built-in/)
    }
    expect(validateResidentKindManifest({ id: 'Bad Id', name: 'X' }, RESERVED).ok).toBe(false)
  })

  it('caps every string: name 40, blurb 200, prompt 20,000', () => {
    const m = valid({ id: 'scribe', name: 'n'.repeat(100), blurb: 'b'.repeat(500), prompt: 'p'.repeat(30_000),
      cycle: { everyMinutes: 15, prompt: 'c'.repeat(30_000), doing: 'd'.repeat(100) } })
    expect(m.name).toHaveLength(40)
    expect(m.blurb).toHaveLength(200)
    expect(m.prompt).toHaveLength(20_000)
    expect(m.cycle?.prompt).toHaveLength(20_000)
    expect(m.cycle?.doing).toHaveLength(40)
  })

  it('strips control characters from text', () => {
    expect(valid({ id: 'scribe', name: 'A\u001b[31mB' }).name).toBe('A[31mB')
  })

  it('drops unknown keys and the fields a manifest may not set', () => {
    const m = valid({ id: 'scribe', name: 'S', bins: { x: ['rm'] }, env: { A: '1' }, prepare: 'x', digests: true,
      commands: ['ls'], permissionMode: 'auto', extra: 1 })
    expect(Object.keys(m).sort()).toEqual(['appearance', 'blurb', 'capabilities', 'id', 'name', 'optionFields', 'prompt', 'quickActions'])
  })

  it('keeps known capabilities, text option fields and prompt quick actions only', () => {
    const m = valid({
      id: 'scribe', name: 'S',
      capabilities: ['sessions.read', 'gitlab.approve', 'root', 'space.notes'],
      optionFields: [{ key: 'repo', label: 'Repo', help: 'h', input: 'text', required: true },
        { key: 'dir', label: 'Dir', help: 'h', input: 'folder', required: false }],
      quickActions: [{ id: 'sum', label: 'Sum', doing: 'Summing', run: { kind: 'prompt', text: 'Summarise' } },
        { id: 'ls', label: 'Ls', doing: 'Ls', run: { kind: 'command', argv: ['ls'] } }],
      appearance: { glyph: 'honeypot', palette: 'nope', animation: 'stir' },
      toolPolicy: { disallowedTools: ['Bash', 3] },
    })
    expect(m.capabilities).toEqual(['sessions.read', 'space.notes'])
    expect(m.optionFields.map((f) => f.key)).toEqual(['repo'])
    expect(m.quickActions).toEqual([{ id: 'sum', label: 'Sum', doing: 'Summing', text: 'Summarise' }])
    expect(m.appearance).toEqual({ glyph: 'honeypot', palette: 'gold', animation: 'stir' })
    expect(m.toolPolicy).toEqual({ disallowedTools: ['Bash'] })
  })

  it('accepts a cycle only at a listed interval', () => {
    expect(valid({ id: 's', cycle: { everyMinutes: 15, prompt: 'go' } }).cycle?.everyMinutes).toBe(15)
    expect(validateResidentKindManifest({ id: 's', cycle: { everyMinutes: 7, prompt: 'go' } }, RESERVED).ok).toBe(false)
  })
})

describe('manifestKind', () => {
  it('builds a kind with no setup, no bins, a manual permission mode and the preamble before the prompt', () => {
    const kind = manifestKind(valid({ id: 'scribe', name: 'Scribe', prompt: 'from kind.json' }), 'Write notes.')
    expect(kind.setup(kind.defaults as never)).toBeNull()
    expect(kind.bins).toEqual({})
    expect(kind.env).toBeUndefined()
    expect(kind.prepare).toBeUndefined()
    expect(kind.digests).toBe(false)
    expect(kind.defaults.permissionMode).toBe('manual')
    const prompt = kind.systemPrompt('Ada')
    expect(prompt).toMatch(/^You are Ada/)
    expect(prompt.endsWith('Write notes.')).toBe(true)
  })

  it('turns quick actions into prompt runs', () => {
    const kind = manifestKind(valid({ id: 'scribe', quickActions: [{ id: 'a', label: 'A', doing: 'D', run: { kind: 'prompt', text: 'T' } }] }), '')
    expect(kind.quickActions).toEqual([{ id: 'a', label: 'A', doing: 'D', run: { kind: 'prompt', text: 'T' } }])
  })
})

describe('readManifestKinds', () => {
  it('reads each folder once, keeps the valid ones and reports the rest by folder and reason', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kinds-'))
    const put = (folder: string, kind: unknown, prompt?: string): void => {
      mkdirSync(join(dir, folder))
      writeFileSync(join(dir, folder, 'kind.json'), typeof kind === 'string' ? kind : JSON.stringify(kind))
      if (prompt !== undefined) writeFileSync(join(dir, folder, 'PROMPT.md'), prompt)
    }
    put('scribe', { id: 'scribe', name: 'Scribe' }, 'Take notes.')
    put('regent', { id: 'regent', name: 'Fake' })
    put('broken', '{not json')
    put('elsewhere', { id: 'other', name: 'Mismatch' })
    const bad: { folder: string; reason: string }[] = []
    const kinds = readManifestKinds(dir, RESERVED, (folder, reason) => { bad.push({ folder, reason }) })
    expect(kinds.map((k) => k.id)).toEqual(['scribe'])
    expect(kinds[0]?.systemPrompt('S')).toContain('Take notes.')
    expect(bad.map((b) => b.folder).sort()).toEqual(['broken', 'elsewhere', 'regent'])
  })

  it('a missing folder is no kinds', () => {
    expect(readManifestKinds(join(tmpdir(), 'no-such-apiary-kinds'), RESERVED, () => undefined)).toEqual([])
  })
})

describe('a data kind in the registry', () => {
  it('registers beside the built-ins and is shown to the renderer', () => {
    const kind = manifestKind(valid({ id: 'scribe', name: 'Scribe' }), '')
    const reg = new KindRegistry()
    reg.register(kind)
    expect(reg.get(kind.id)).toBe(kind)
    showDataKinds([kind])
    expect(kindInfos().map((i) => i.id)).toContain('scribe')
  })
})
