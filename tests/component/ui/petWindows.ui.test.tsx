import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { fakePet, type FakeApiary } from '../fakeApiary'
import type { PetRecord } from '@shared/pets/state'
import { reviewUi } from './review'

/** Pets out across windows: this window (number 1) draws only its own. */
function out(fake: FakeApiary, pets: PetRecord[]): void {
  fake.state.pets = { enabled: true, generating: false, arrival: null, pets }
  fake.emit('petsChanged', fake.state.pets)
}

const THREE_IN_TWO_WINDOWS = [
  fakePet('pip', { window: 1 }),
  fakePet('bo', { window: 2, spec: { ...fakePet('x').spec, name: 'Bo' } }),
  fakePet('kit', { window: 2, spec: { ...fakePet('x').spec, name: 'Kit' } }),
  fakePet('away', { active: false, window: null, spec: { ...fakePet('x').spec, name: 'Sleepy' } }),
]

describe('UI: pets across windows', () => {
  it('a window with one of the three pets', async () => {
    const { fake } = await renderApp()
    out(fake, THREE_IN_TWO_WINDOWS)
    await until(() => document.querySelectorAll('[data-testid="pet"]').length === 1)
    await reviewUi('pets one in this window')
  })

  it('settings lists which window each pet is out in', async () => {
    const { fake } = await renderApp()
    out(fake, THREE_IN_TWO_WINDOWS)
    fake.emit('openSettingsDialog')
    await userEvent.click(page.getByTestId('settings-nav-pets'))
    await until(() => document.querySelectorAll('[data-testid="pet-card-window"]').length === 3)
    await reviewUi('pets settings window labels', { widths: [620, 900] })
  })
})
