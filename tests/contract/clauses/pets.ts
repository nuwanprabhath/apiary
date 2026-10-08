import { describe, expect, it } from 'vitest'
import { MAX_ACTIVE_PETS, PET_SIZES } from '@shared/pets/state'
import type { Ctx } from '../support'

const VOICE = { working: 1, waiting: 0, finished: 2, titles: ['Fix CSV export bug'], hour: 14 }

export function definePetClauses(ctx: Ctx): void {
  /** Turns pets on (which hatches the first one) and returns it. */
  async function firstPet(): Promise<string> {
    await ctx.api.petsSetEnabled(true)
    return (await ctx.api.petsState()).pets[0].id
  }

  describe('pets', () => {
    it('start off, with none hatched', async () => {
      expect(await ctx.api.petsState()).toEqual({ enabled: false, pets: [], generating: false })
    })

    it('turning them on for the first time hatches one that is out, and tells every view; off and on again hatches no more', async () => {
      await ctx.api.petsSetEnabled(true)
      const on = await ctx.api.petsState()
      expect(on).toMatchObject({ enabled: true, generating: false })
      expect(on.pets).toHaveLength(1)
      expect(on.pets[0]).toMatchObject({ active: true, place: null })
      expect(on.pets[0].spec.name).not.toBe('')
      expect(ctx.heard.count('petsChanged')).toBeGreaterThan(0)
      expect(ctx.heard.payloads('petsChanged').at(-1)?.[0].enabled).toBe(true)

      await ctx.api.petsSetEnabled(false)
      expect(await ctx.api.petsState()).toMatchObject({ enabled: false, pets: [{ id: on.pets[0].id }] })
      await ctx.api.petsSetEnabled(true)
      expect((await ctx.api.petsState()).pets).toHaveLength(1)
    })

    it('hatches a pet with the model asked for (haiku when it asks for none or a model there is not), and puts at most three out', async () => {
      const sonnet = await ctx.api.petGenerate('a frog', 'sonnet')
      expect(sonnet).toMatchObject({ model: 'sonnet', active: true })
      expect((await ctx.api.petGenerate(null, null)).model).toBe('haiku')
      expect((await ctx.api.petGenerate('a cat', 'gpt-9')).model).toBe('haiku')
      expect((await ctx.api.petGenerate(null, 'opus')).active).toBe(false)
      const state = await ctx.api.petsState()
      expect(state.pets).toHaveLength(4)
      expect(state.pets.filter((p) => p.active)).toHaveLength(MAX_ACTIVE_PETS)
      expect(state.generating).toBe(false)
      expect(new Set(state.pets.map((p) => p.id)).size).toBe(4)
      ctx.api.petGenerateCancel()
    })

    it('updates a pet: the size is clamped and rounded, the place is clamped, a name is kept, and every view hears of it', async () => {
      const id = await firstPet()
      ctx.heard.reset()
      expect((await ctx.api.petUpdate(id, { size: 5000 })).size).toBe(PET_SIZES.max)
      expect((await ctx.api.petUpdate(id, { size: 1 })).size).toBe(PET_SIZES.min)
      expect((await ctx.api.petUpdate(id, { size: 70.6 })).size).toBe(71)
      expect((await ctx.api.petUpdate(id, { place: { region: 'rail', at: 7 } })).place).toEqual({ region: 'rail', at: 1 })
      expect((await ctx.api.petUpdate(id, { place: null })).place).toBeNull()
      expect((await ctx.api.petUpdate(id, { model: 'opus' })).model).toBe('opus')
      expect((await ctx.api.petUpdate(id, { name: 'Rex' })).spec.name).toBe('Rex')
      expect((await ctx.api.petsState()).pets[0]).toMatchObject({ id, size: 71, model: 'opus' })
      expect(ctx.heard.count('petsChanged')).toBe(7)
    })

    it('refuses to update a pet that does not exist, to put a fourth out, and a patch of the wrong kind', async () => {
      const id = await firstPet()
      await expect(ctx.api.petUpdate('no-such-pet', { size: 50 })).rejects.toThrow()
      await ctx.api.petGenerate(null, null)
      await ctx.api.petGenerate(null, null)
      const spare = await ctx.api.petGenerate(null, null)
      expect(spare.active).toBe(false)
      await expect(ctx.api.petUpdate(spare.id, { active: true })).rejects.toThrow()
      await ctx.api.petUpdate(id, { active: false })
      expect((await ctx.api.petUpdate(spare.id, { active: true })).active).toBe(true)
      await expect(ctx.api.petUpdate(id, { size: 'big' } as never)).rejects.toThrow()
      await expect(ctx.api.petUpdate(id, { model: 'gpt-9' } as never)).rejects.toThrow()
      expect((await ctx.api.petsState()).pets.find((p) => p.id === id)?.size).toBe(PET_SIZES.default)
    })

    it('deletes a pet and tells every view; deleting one that is gone is an error', async () => {
      const id = await firstPet()
      ctx.heard.reset()
      await ctx.api.petDelete(id)
      expect((await ctx.api.petsState()).pets).toEqual([])
      expect(ctx.heard.count('petsChanged')).toBe(1)
      await expect(ctx.api.petDelete(id)).rejects.toThrow()
    })

    it('exports a pet to the file the user picked, and imports it back as a new pet', async () => {
      const id = await firstPet()
      expect(await ctx.api.petExport(id)).toBe(true)
      await expect(ctx.api.petExport('no-such-pet')).rejects.toThrow()
      ctx.heard.reset()
      const imported = await ctx.api.petImport()
      expect(imported).not.toBeNull()
      expect(imported?.id).not.toBe(id)
      expect(imported?.spec.name).toBe((await ctx.api.petsState()).pets[0].spec.name)
      expect((await ctx.api.petsState()).pets).toHaveLength(2)
      expect(ctx.heard.count('petsChanged')).toBeGreaterThan(0)
    })

    it('chats in character, and refuses a blank message or a pet that is not there', async () => {
      const id = await firstPet()
      expect((await ctx.api.petChat(id, 'hello')).length).toBeGreaterThan(0)
      await expect(ctx.api.petChat(id, '   ')).rejects.toThrow()
      await expect(ctx.api.petChat('no-such-pet', 'hello')).rejects.toThrow()
    })

    it('writes new lines for a pet once an hour, and not at all while pets are off', async () => {
      const id = await firstPet()
      await ctx.api.petsSetEnabled(false)
      expect(await ctx.api.petVoice(id, VOICE)).toBe(false)
      await ctx.api.petsSetEnabled(true)
      expect(await ctx.api.petVoice(id, VOICE)).toBe(true)
      expect(await ctx.api.petVoice(id, VOICE)).toBe(false)
      expect(await ctx.api.petVoice('no-such-pet', VOICE)).toBe(false)
      await expect(ctx.api.petVoice(id, { ...VOICE, hour: 'noon' } as never)).rejects.toThrow()
    })

    it('says nothing about what Claude is doing, or what a pet thinks of it, while pets are off', async () => {
      const id = await firstPet()
      await ctx.api.petsSetEnabled(false)
      expect(await ctx.api.petClaudeActions(['some-session'])).toEqual([])
      expect(await ctx.api.petComment(id, 'Edit: csvWriter.ts')).toBeNull()
      expect(await ctx.api.petComment('no-such-pet', 'Edit: csvWriter.ts')).toBeNull()
    })
  })
}
