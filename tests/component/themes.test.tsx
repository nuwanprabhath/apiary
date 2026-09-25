import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/**
 * Opens Settings and lands on the Themes section. `fake.emit` runs synchronously, outside any
 * React event handler, so the dialog is not yet in the DOM the instant this call returns — waited
 * for directly rather than through `expect.element`, whose first (failing) poll here trips a
 * pretty-format recursion bug when asked to print a locator that resolved to nothing.
 */
async function openThemes(fake: { emit: (event: 'openSettingsDialog') => void }): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-themes'))
  await expect.element(page.getByTestId('themes-section')).toBeVisible()
}

const themeCard = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-testid="theme-card"][data-theme-id="${id}"]`)

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

describe('themes', () => {
  it('save a copy under a name, rename it, delete it', async () => {
    const { fake } = await renderApp()
    await openThemes(fake)

    await userEvent.click(themeCard('builtin:matrix')!)
    await userEvent.click(page.getByTestId('theme-save-as'))
    await userEvent.fill(page.getByTestId('theme-save-name'), 'My matrix')
    await userEvent.click(page.getByTestId('theme-save-confirm'))
    await expect.element(page.getByTestId('theme-current-name')).toHaveTextContent('My matrix')
    const findCard = (text: string): HTMLElement | undefined =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="theme-card"]')]
        .find((c) => c.textContent?.includes(text) === true)
    await until(() => findCard('My matrix')?.getAttribute('data-active') === 'true')

    await userEvent.click(page.getByTestId('theme-rename'))
    await userEvent.fill(page.getByTestId('theme-save-name'), 'Green rain')
    await userEvent.click(page.getByTestId('theme-save-confirm'))
    await until(() => findCard('Green rain') !== undefined)

    const wrap = [...document.querySelectorAll<HTMLElement>('.theme-card-wrap')]
      .find((w) => w.textContent?.includes('Green rain') === true)!
    await userEvent.hover(wrap)
    const deleteButton = wrap.querySelector<HTMLElement>('[data-testid="theme-delete"]')!
    await userEvent.click(deleteButton)
    await until(() => findCard('Green rain') === undefined)
    expect(themeCard('original')?.getAttribute('data-active')).toBe('true')
  })

  it('with animated effects off, the effects draw one still frame and no more', async () => {
    const { fake } = await renderApp()
    await openThemes(fake)
    await userEvent.click(themeCard('builtin:matrix')!)

    const frames = (): number => Number(
      document.querySelector<HTMLElement>('[data-testid="theme-effects-back"]')?.dataset.frames ?? '0',
    )
    await until(() => frames() > 3)

    // Applied once main confirms it, so clicked and then waited for rather than an instant read.
    await userEvent.click(page.getByTestId('theme-animated'))
    await expect.element(page.getByTestId('theme-animated')).not.toBeChecked()
    // Lets any in-flight animation frame finish before taking the "settled" baseline count below.
    await new Promise((resolve) => setTimeout(resolve, 300))
    const settled = frames()
    // Proving a negative: that no further frames are drawn once animation is off, so there is no
    // condition to poll for other than re-checking after time passes.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(frames()).toBe(settled)
  })

  it('the Themes screen shows what is applied now, and dialogs stay solid over a translucent theme', async () => {
    const { fake } = await renderApp()
    // Applied before the screen exists: it must not show what was true when the window loaded.
    await fake.themeApply('builtin:neon')
    await until(() => cssVar('--accent') === '#ff2a6dff')
    await openThemes(fake)
    await expect.element(page.getByTestId('theme-current-name')).toHaveTextContent('Neon cyberpunk')
    expect(themeCard('builtin:neon')?.getAttribute('data-active')).toBe('true')

    // Neon's panels are see-through so its grid shows; the dialog over them must not be.
    const bg = getComputedStyle(document.querySelector('[data-testid="settings-dialog"]')!).backgroundColor
    expect(bg).toMatch(/^rgb\(/)
  })

  it('the terminal colour reaches the bottom of its pane, with no bar under the last row', async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()

    await fake.themeApply('builtin:glass')
    await until(() => document.querySelector('html')?.getAttribute('data-material') === 'glass')

    const host = document.querySelector('[data-testid="terminal-shell"]')!.closest('.terminal-host')!
    const viewport = host.querySelector('.xterm-viewport')!
    const screen = host.querySelector('.xterm-screen')!.getBoundingClientRect()
    const sliver = host.getBoundingClientRect().bottom - screen.bottom
    const hostBg = getComputedStyle(host).backgroundColor
    const viewportBg = getComputedStyle(viewport).backgroundColor
    const termBg = cssVar('--term-background')

    // xterm draws whole rows only, so there is a sliver under the last one; the host's colour —
    // the terminal's — fills it, not whatever is behind.
    expect(sliver).toBeGreaterThan(0)
    expect(viewportBg).toBe('rgba(0, 0, 0, 0)')
    expect(hostBg).not.toBe('rgba(0, 0, 0, 0)')
    expect(termBg).not.toBe('')
  })
})
