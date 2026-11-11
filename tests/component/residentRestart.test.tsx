/** The popup's Restart button: at once when idle, asks first while a turn runs, off while asleep. */
import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { stays, until } from './helpers'
import { regentStatus, withRegent } from './residentFixtures'
import type { FakeApiary } from './fakeApiary'

const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
const restart = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-testid="resident-popup-restart"]')!

async function openPopup(enabled = true): Promise<FakeApiary> {
  const { fake } = await renderApp({}, (f) => { withRegent(f, { enabled }) })
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
  await until(() => popup() !== null)
  return fake
}

describe('restarting a resident', () => {
  it('sits left of the trash with its own title, and restarts at once when idle', async () => {
    const fake = await openPopup()
    expect(restart().getAttribute('aria-label')).toBe('Restart Regent')
    expect(restart().title).toContain('Starts its claude again, picking up changed settings and permissions')
    expect(restart().nextElementSibling?.getAttribute('aria-label')).toBe('Clear history')
    await userEvent.click(restart())
    await until(() => fake.callsTo('residentRestart').length === 1)
    expect(fake.callsTo('residentRestart')[0]).toEqual(['regent'])
    await until(() => popup()!.textContent.includes('Restarted.'))
  })

  it('while a turn runs it asks first, and only Yes restarts', async () => {
    const fake = await openPopup()
    fake.emit('residentsChanged', [regentStatus('working', 'Searching')])
    await until(() => document.querySelector('[data-testid="resident-popup-stop"]') !== null)
    await userEvent.click(restart())
    await until(() => popup()!.textContent.includes('Restart? It stops the current reply.'))
    await stays(() => fake.callsTo('residentRestart').length === 0, 50, 'no restart before Yes')
    const yes = [...popup()!.querySelectorAll('.resident-confirm button')].find((b) => b.textContent === 'Yes')!
    await userEvent.click(yes)
    await until(() => fake.callsTo('residentRestart').length === 1)
  })

  it('is disabled, with the reason, while asleep', async () => {
    const fake = await openPopup(false)
    expect(restart().disabled).toBe(true)
    expect(restart().title).toContain('asleep')
    expect(fake.callsTo('residentRestart')).toHaveLength(0)
  })
})
