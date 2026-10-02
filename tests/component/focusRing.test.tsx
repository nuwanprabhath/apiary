import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

/**
 * Chromium's own focus ring (`outline: auto`, in the OS accent colour — a white-and-orange double
 * border on a machine set to orange) must never show: keyboard focus is the app's ring. Checked on
 * every focusable element on screen rather than a list, so an element added later is covered too.
 */
const FOCUSABLE = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'

async function offenders(): Promise<string[]> {
  // A key press first: Chromium only draws its ring for keyboard focus, and a focus() call after
  // one counts as keyboard focus — exactly how it appeared (Escape closing a dialog hands focus back).
  await userEvent.keyboard('{Shift}')
  const bad: string[] = []
  for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.offsetParent === null || el.hasAttribute('disabled')) continue
    el.focus()
    if (document.activeElement !== el) continue
    const style = getComputedStyle(el)
    if (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') {
      bad.push(`${el.tagName.toLowerCase()}.${el.className} [${el.getAttribute('data-testid') ?? ''}] outline: ${style.outlineStyle}`)
    }
    // Keyboard focus is still shown: the app's ring, or the element's own focus style.
    expect(el.matches(':focus-visible')).toBe(true)
  }
  return bad
}

describe('focus ring', () => {
  it('no element shows the platform focus ring — sidebar, session pane, chat box', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('composer-input')).toBeVisible()
    expect(await offenders()).toEqual([])
  })

  it('nor in an open menu or dialog', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('composer-model-pill'))
    expect(await offenders()).toEqual([])
    await userEvent.keyboard('{Escape}')
    await userEvent.click(sidebarSession('Fix CSV export bug'), { button: 'right' })
    await expect.element(page.getByTestId('sidebar-menu')).toBeVisible()
    expect(await offenders()).toEqual([])
  })
})
