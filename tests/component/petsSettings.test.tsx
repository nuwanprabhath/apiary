import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { fakePet, type FakeApiary } from './fakeApiary'

/** Settings → Pets: everything applies at once, through the pet calls. */
async function openPets(): Promise<FakeApiary> {
  const { fake } = await renderApp()
  fake.emit('openSettingsDialog')
  await userEvent.click(page.getByTestId('settings-nav-pets'))
  await expect.element(page.getByTestId('pets-section')).toBeVisible()
  return fake
}

describe('Settings → Pets', () => {
  it('turning pets on hatches the first one, which walks out at once', async () => {
    const fake = await openPets()
    await userEvent.click(page.getByTestId('setting-pets-enabled'))
    expect(fake.callsTo('petsSetEnabled')).toEqual([[true]])
    await expect.element(page.getByTestId('pet-card')).toBeVisible()
    await expect.element(page.getByTestId('pet')).toBeInTheDocument()
  })

  it('hatches a pet from a description with the model chosen, or a surprise', async () => {
    const fake = await openPets()
    fake.state.pets = { enabled: true, generating: false, arrival: null, pets: [fakePet('pip')] }
    fake.emit('petsChanged', fake.state.pets)
    await userEvent.selectOptions(page.getByTestId('pet-new-model'), 'sonnet')
    await userEvent.fill(page.getByTestId('pet-describe'), 'a frog in a crown')
    await userEvent.click(page.getByTestId('pet-generate'))
    await userEvent.click(page.getByTestId('pet-surprise'))
    expect(fake.callsTo('petGenerate')).toEqual([['a frog in a crown', 'sonnet'], [null, 'sonnet']])
    await expect.poll(() => document.querySelectorAll('[data-testid="pet-card"]').length).toBe(3)
    await page.screenshot({ path: '../../test-results/pets/settings.png' })
  })

  it('lets at most three out, and says why a fourth cannot come out', async () => {
    const fake = await openPets()
    fake.state.pets = { enabled: true, generating: false, arrival: null, pets: ['a', 'b', 'c', 'd'].map((id, i) => fakePet(id, { active: i < 3 })) }
    fake.emit('petsChanged', fake.state.pets)
    await expect.poll(() => document.querySelectorAll('[data-testid="pet-card"]').length).toBe(4)
    const fourth = document.querySelector('[data-pet-id="d"] [data-testid="pet-card-out"]')!
    expect((fourth as HTMLInputElement).disabled).toBe(true)
    expect(fourth.closest('label')!.title).toContain('Up to 3 pets')
    await userEvent.click(page.getByTestId('pet-card-out').first())
    expect(fake.callsTo('petUpdate').at(-1)).toEqual(['a', { active: false }])
  })

  it('changes a pet\'s model, renames, exports, and deletes only once confirmed', async () => {
    const fake = await openPets()
    fake.state.pets = { enabled: true, generating: false, arrival: null, pets: [fakePet('pip')] }
    fake.emit('petsChanged', fake.state.pets)
    await userEvent.selectOptions(page.getByTestId('pet-card-model'), 'opus')
    expect(fake.callsTo('petUpdate').at(-1)).toEqual(['pip', { model: 'opus' }])
    await userEvent.fill(page.getByTestId('pet-card-name'), 'Pipster')
    await userEvent.click(page.getByTestId('pet-card-export'))
    expect(fake.callsTo('petUpdate')).toContainEqual(['pip', { name: 'Pipster' }])
    expect(fake.callsTo('petExport')).toEqual([['pip']])
    await userEvent.click(page.getByTestId('pet-card-delete'))
    expect(fake.callsTo('petDelete')).toEqual([])
    await userEvent.click(page.getByTestId('pet-card-delete-confirm'))
    expect(fake.callsTo('petDelete')).toEqual([['pip']])
  })

  it('with more than one window open, each pet that is out says which window it is in', async () => {
    const fake = await openPets()
    fake.state.pets = { enabled: true, generating: false, arrival: null, pets: [fakePet('a', { window: 1 }), fakePet('b', { window: 2 }), fakePet('c', { active: false, window: null })] }
    fake.emit('petsChanged', fake.state.pets)
    const label = (id: string): string | null => document.querySelector(`[data-pet-id="${id}"] [data-testid="pet-card-window"]`)?.textContent ?? null
    await expect.poll(() => label('b')).toBe('Window 2')
    expect([label('a'), label('c')]).toEqual(['Window 1', null])
  })

  it('with one window open, no pet says which window it is in', async () => {
    const fake = await openPets()
    fake.state.pets = { enabled: true, generating: false, arrival: null, pets: [fakePet('a'), fakePet('b')] }
    fake.emit('petsChanged', fake.state.pets)
    await expect.poll(() => document.querySelectorAll('[data-testid="pet-card"]').length).toBe(2)
    expect(document.querySelector('[data-testid="pet-card-window"]')).toBeNull()
  })

  it('shows what went wrong when a pet cannot be hatched', async () => {
    const fake = await openPets()
    fake.state.pets = { enabled: true, generating: false, arrival: null, pets: [] }
    fake.emit('petsChanged', fake.state.pets)
    fake.override('petGenerate', async () => { throw new Error("Claude's reply had no pet in it. Try describing it differently.") })
    await userEvent.click(page.getByTestId('pet-surprise'))
    await expect.poll(() => document.querySelector('[data-testid="pets-error"]')?.textContent ?? '').toContain('no pet in it')
  })
})
