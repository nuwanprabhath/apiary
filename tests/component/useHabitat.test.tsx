import { describe, it, expect, vi, afterEach } from 'vitest'
import type { JSX } from 'react'
import { mountUi } from './mountUi'
import { useHabitat } from '../../src/renderer/features/pets/useHabitat'

/**
 * `useHabitat` measures the status bar the pets stand on. The bar may not be in the page when pets
 * are switched on, so the hook has to notice it appearing; it used to do that with a 1 s interval
 * that kept running for as long as pets were out.
 */
function Probe(): JSX.Element {
  const habitat = useHabitat(true, false)
  return <output data-testid="habitat">{habitat === null ? 'none' : String(Math.round(habitat.bar.width))}</output>
}

const shown = (): string | undefined => document.querySelector('[data-testid="habitat"]')?.textContent

describe('useHabitat', () => {
  afterEach(() => {
    document.querySelector('[data-testid="status-bar-floor"]')?.remove()
    vi.restoreAllMocks()
  })

  it('finds a status bar that renders after it, and keeps no interval running either way', async () => {
    const setInterval = vi.spyOn(window, 'setInterval')
    await mountUi(<Probe />)
    expect(shown()).toBe('none')

    const bar = document.createElement('div')
    bar.dataset.testid = 'status-bar-floor'
    bar.style.cssText = 'position:fixed;left:0;bottom:0;width:321px;height:24px'
    document.body.appendChild(bar)

    await expect.poll(shown).toBe('321')
    expect(setInterval).not.toHaveBeenCalled()
  })

  it('notices the bar resizing once it has found it', async () => {
    const bar = document.createElement('div')
    bar.dataset.testid = 'status-bar-floor'
    bar.style.cssText = 'position:fixed;left:0;bottom:0;width:200px;height:24px'
    document.body.appendChild(bar)
    await mountUi(<Probe />)
    await expect.poll(shown).toBe('200')
    bar.style.width = '260px'
    await expect.poll(shown).toBe('260')
  })
})
