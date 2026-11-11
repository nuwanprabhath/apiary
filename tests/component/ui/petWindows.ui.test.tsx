import { describe, it, expect } from 'vitest'
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

  it.each([
    ['two windows', [{ number: 2, title: 'Fix CSV export' }]],
    ['five windows and a long tab title', [
      { number: 2, title: 'Fix CSV export' }, { number: 3, title: 'Apiary' },
      { number: 4, title: 'Refactor the session store so that a rescan never writes a project path back over the override the person chose' },
      { number: 5, title: 'Release 1.60' }, { number: 6, title: 'Pet menu' },
    ]],
  ])('the pet menu\'s "Move to" submenu with %s', async (name, others) => {
    const { fake } = await renderApp()
    fake.state.appWindows = [
      { number: 1, title: 'Here', focused: true, minimized: false, remoteHost: null },
      ...others.map((w) => ({ ...w, focused: false, minimized: false, remoteHost: null })),
    ]
    fake.emit('appWindowsChanged')
    out(fake, THREE_IN_TWO_WINDOWS)
    await until(() => document.querySelectorAll('[data-testid="pet"]').length === 1)
    await reviewUi(`pet menu move to, ${name}`, {
      // Opened after each resize: the flyout measures where it fits as it opens.
      open: async () => {
        await until(() => document.querySelectorAll('[data-testid="pet"]').length === 1)
        await userEvent.click(page.getByTestId('pet'), { button: 'right', force: true })
        await userEvent.click(page.getByRole('menuitem', { name: 'Move to' }))
        await until(() => document.querySelector('[data-testid="context-submenu"]') !== null)
      },
      close: async () => {
        await userEvent.keyboard('{Escape}')
        await until(() => document.querySelector('[data-testid="pet-menu"]') === null)
      },
    })
  })

  it('the pet menu with no other window', async () => {
    const { fake } = await renderApp()
    out(fake, THREE_IN_TWO_WINDOWS)
    await until(() => document.querySelectorAll('[data-testid="pet"]').length === 1)
    await reviewUi('pet menu move to disabled', {
      open: async () => {
        await userEvent.click(page.getByTestId('pet'), { button: 'right', force: true })
        await expect.element(page.getByRole('menuitem', { name: 'Move to (no other window)' })).toBeVisible()
      },
      close: async () => {
        await userEvent.keyboard('{Escape}')
        await until(() => document.querySelector('[data-testid="pet-menu"]') === null)
      },
    })
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
