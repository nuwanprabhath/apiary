import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PetStore } from '../../src/main/pets/petStore'
import { PetService, VOICE_INTERVAL_MS, COMMENT_INTERVAL_MS } from '../../src/main/pets/petService'
import { STARTER_PET } from '@shared/pets/builtins'

/**
 * The pets' calls to claude, against a stand-in that answers by what it is asked (the last
 * argument is the prompt) and records that prompt.
 */
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-petsvc-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const envelope = (o: object): string => JSON.stringify({ type: 'result', is_error: false, ...o })
const ctx = { working: 1, waiting: 0, finished: 0, titles: ['Fix the login bug'], hour: 14 }

function setup(cases: Record<string, string>, now: { t: number } = { t: 1_000_000 }): { svc: PetService; store: PetStore; changed: () => number; lastPrompt: () => string } {
  for (const [name, body] of Object.entries(cases)) writeFileSync(join(dir, `${name}.json`), body)
  const script = join(dir, 'claude')
  writeFileSync(script, [
    '#!/bin/sh',
    'for a; do last=$a; done',
    `printf '%s' "$last" > "${dir}/prompt.txt"`,
    'case "$last" in',
    '  *FAILPLEASE*) echo "overloaded" >&2; exit 1 ;;',
    `  *"Design a tiny desktop pet"*) cat "${dir}/design.json" ;;`,
    `  *"Write fresh lines"*) cat "${dir}/voice.json" ;;`,
    `  *"peeking over at Claude"*) cat "${dir}/comment.json" ;;`,
    `  *) cat "${dir}/chat.json" ;;`,
    'esac',
  ].join('\n'))
  chmodSync(script, 0o755)
  const store = new PetStore(join(dir, 'pets.json'))
  let n = 0
  const svc = new PetService({ store, claudeBin: () => script, shell: '/bin/sh', onChanged: () => { n++ }, now: () => now.t })
  return { svc, store, changed: () => n, lastPrompt: () => readFileSync(join(dir, 'prompt.txt'), 'utf8') }
}

describe('PetService', () => {
  it('hatches a validated pet from what Claude designed, with the model it was asked for', async () => {
    const { svc, store } = setup({ design: envelope({ structured_output: { ...STARTER_PET, name: 'Zed', body: { ...STARTER_PET.body, color: 'url(x)' } } }) })
    const pet = await svc.generate('a frog', 'sonnet')
    expect(pet.spec.name).toBe('Zed')
    expect(pet.spec.body.color).toBe('#3b82f6')
    expect(store.get(pet.id)?.model).toBe('sonnet')
    expect(svc.state().generating).toBe(false)
  })

  it('turning pets on the first time hatches one, and falls back to the starter pet when Claude cannot', async () => {
    const ok = setup({ design: envelope({ structured_output: { ...STARTER_PET, name: 'Zed' } }) })
    await ok.svc.setEnabled(true)
    expect(ok.store.list().map((p) => p.spec.name)).toEqual(['Zed'])
    rmSync(join(dir, 'pets.json'))

    const broken = setup({ design: envelope({ is_error: true, result: 'nope' }) })
    await broken.svc.setEnabled(true)
    expect(broken.store.list().map((p) => p.spec.name)).toEqual(['Pip'])
    // Turning it off and on again hatches nothing new.
    await broken.svc.setEnabled(false)
    await broken.svc.setEnabled(true)
    expect(broken.store.list()).toHaveLength(1)
  })

  it('writes new lines at most once an hour per pet, from counts and titles', async () => {
    const now = { t: 10 * VOICE_INTERVAL_MS }
    const { svc, store, lastPrompt } = setup({ voice: envelope({ structured_output: { lines: { idle: ['Fresh one!', 42] } } }) }, now)
    store.setEnabled(true)
    const pet = store.add(STARTER_PET)
    expect(await svc.voice(pet.id, ctx)).toBe(true)
    expect(store.get(pet.id)?.spec.lines.idle).toEqual(['Fresh one!'])
    expect(lastPrompt()).toContain('Fix the login bug')
    now.t += VOICE_INTERVAL_MS - 1
    expect(await svc.voice(pet.id, ctx)).toBe(false)
    now.t += 1
    expect(await svc.voice(pet.id, ctx)).toBe(true)
  })

  it('does not voice a pet that is off, or while pets are off, and a failure waits out the hour too', async () => {
    const now = { t: 10 * VOICE_INTERVAL_MS }
    const { svc, store } = setup({ voice: envelope({ is_error: true }) }, now)
    const pet = store.add(STARTER_PET)
    expect(await svc.voice(pet.id, ctx)).toBe(false) // pets off
    store.setEnabled(true)
    expect(await svc.voice(pet.id, { ...ctx, titles: ['FAILPLEASE'] })).toBe(false)
    expect(store.get(pet.id)?.voicedAt).toBe(0)
    writeFileSync(join(dir, 'voice.json'), envelope({ structured_output: { lines: { idle: ['ok'] } } }))
    expect(await svc.voice(pet.id, ctx)).toBe(false) // tried within the hour
  })

  it('chats in character, remembering what was said before', async () => {
    const { svc, store, lastPrompt } = setup({ chat: envelope({ result: '  Hello\u0007 there!  ' }) })
    const pet = store.add(STARTER_PET)
    expect(await svc.chat(pet.id, 'hi pip')).toBe('Hello there!')
    await svc.chat(pet.id, 'how are you?')
    expect(lastPrompt()).toContain('"hi pip"')
    expect(lastPrompt()).toContain('"Hello there!"')
    await expect(svc.chat(pet.id, '   ')).rejects.toThrow('Say something first.')
  })

  it('says so when the reply is empty or claude fails', async () => {
    const { svc, store } = setup({ chat: envelope({ result: '' }) })
    const pet = store.add(STARTER_PET)
    await expect(svc.chat(pet.id, 'hi')).rejects.toThrow("Pip didn't answer")
    await expect(svc.chat(pet.id, 'FAILPLEASE')).rejects.toThrow('could not be run')
  })

  it('remarks on what Claude is doing at most once every few minutes, told only the action', async () => {
    const now = { t: 1_000_000 }
    const { svc, store, lastPrompt } = setup({ comment: envelope({ result: '"Ooh, careful with that buffer!"' }) }, now)
    store.setEnabled(true)
    const pet = store.add(STARTER_PET)
    expect(await svc.comment(pet.id, 'Edit: csvWriter.ts')).toBe('Ooh, careful with that buffer!')
    expect(lastPrompt()).toContain('"Edit: csvWriter.ts"')
    now.t += COMMENT_INTERVAL_MS - 1
    expect(await svc.comment(pet.id, 'Bash: Run the tests')).toBeNull()
    now.t += 1
    expect(await svc.comment(pet.id, 'Bash: Run the tests\u0007')).toBe('Ooh, careful with that buffer!')
    expect(lastPrompt()).not.toContain('\u0007')
  })
})
