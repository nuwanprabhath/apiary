import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { deskConfig, withMrDesk } from './residentFixtures'
import type { FakeApiary } from './fakeApiary'

const el = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`)
const badge = (): HTMLElement | null => el('resident-badge-mr-desk')
const popup = (): HTMLElement | null => el('resident-popup')

function rightClick(target: HTMLElement): void {
  const r = target.getBoundingClientRect()
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }))
}

async function chooseAction(label: string): Promise<void> {
  rightClick(badge()!)
  await until(() => el('resident-menu') !== null)
  const item = [...el('resident-menu')!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent.trim() === label)!
  await userEvent.click(item)
}

const release = (fake: FakeApiary): void => { for (const end of fake.state.residentHeld.get('mr-desk')?.splice(0) ?? []) end() }

describe('a quick action shows that it is happening', () => {
  it('Show the desk opens the popup with the request as a chip, the working line and the pill saying "Reading the desk"', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f); f.state.residentHeld.set('mr-desk', []) })
    await until(() => badge()?.dataset.state === 'idle')
    await chooseAction('Show the desk')
    await until(() => popup() !== null && badge()?.dataset.state === 'working')
    expect(badge()!.querySelector('.resident-activity')!.textContent).toBe('Reading the desk')
    await until(() => el('resident-working') !== null)
    expect(el('resident-working')!.textContent).toBe('Reading the desk')
    const chip = popup()!.querySelector<HTMLElement>('[data-testid="resident-action"]')!
    expect(chip.textContent).toBe('Show the desk')
    expect(chip.classList.contains('resident-msg-user')).toBe(false)

    release(fake)
    await until(() => badge()?.dataset.state === 'idle' && el('resident-working') === null)
    expect(popup()!.textContent).toContain('$ python3')
  })

  it('Check now in Settings shows a spinner and "Checking…" while the cycle runs, then goes back', async () => {
    const { fake } = await renderApp({ settings: { residents: [deskConfig({ project: 'g/p', repoPath: '/code/app' })] } }, (f) => { f.state.residentHeld.set('mr-desk', []) })
    fake.emit('openSettingsDialog')
    await until(() => el('settings-dialog') !== null)
    await userEvent.click(page.getByTestId('settings-nav-residents'))
    await until(() => el('resident-check-now-mr-desk') !== null)
    await userEvent.click(page.getByTestId('resident-check-now-mr-desk'))
    await until(() => el('resident-check-now-mr-desk')!.textContent === 'Checking…')
    expect(el('resident-check-now-mr-desk')!.querySelector('.busy-glyph')).not.toBeNull()
    release(fake)
    await until(() => el('resident-check-now-mr-desk')!.textContent === 'Check now')
    expect(el('resident-check-now-mr-desk')!.querySelector('.busy-glyph')).toBeNull()
  })
})
