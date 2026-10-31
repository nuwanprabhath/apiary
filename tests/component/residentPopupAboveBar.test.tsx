import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { drag, until } from './helpers'
import { regentStatus, withRegent } from './residentFixtures'
import { writeResidentPopupRect } from '../../src/renderer/state/uiState'

const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
const bar = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="status-bar"]')!
/** How far the popup's bottom edge reaches past the status bar's top edge (≤ 0: it stays clear). */
const overlap = (): number => popup()!.getBoundingClientRect().bottom - bar().getBoundingClientRect().top

async function open(): Promise<Awaited<ReturnType<typeof renderApp>>['fake']> {
  const { fake } = await renderApp({}, (f) => { withRegent(f) })
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
  await until(() => popup() !== null)
  return fake
}

describe('the resident popup never covers the status bar', () => {
  it('a rect saved against a thin bar opens above a tall one', async () => {
    localStorage.setItem('apiary.statusBarHeight', '52')
    writeResidentPopupRect({ right: 12, bottom: 4, width: 380, height: 480 })
    await open()
    await expect.poll(overlap).toBeLessThanOrEqual(0)
  })

  it('moves up when the bar grows while it is open', async () => {
    localStorage.setItem('apiary.statusBarHeight', '22')
    writeResidentPopupRect({ right: 12, bottom: 23, width: 380, height: 480 })
    const fake = await open()
    expect(overlap()).toBeLessThanOrEqual(0)
    fake.emit('residentsChanged', [regentStatus('working', 'Running mra prompt 1559')])
    await until(() => bar().getBoundingClientRect().height > 22)
    await expect.poll(overlap).toBeLessThanOrEqual(0)
  })

  it('a drag cannot pull it down over the bar', async () => {
    localStorage.setItem('apiary.statusBarHeight', '52')
    await open()
    const header = popup()!.querySelector<HTMLElement>('.resident-popup-header')!
    await drag(header, 0, 2000)
    await expect.poll(overlap).toBeLessThanOrEqual(0)
  })
})
