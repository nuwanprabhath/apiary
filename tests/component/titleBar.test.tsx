import { describe, it, expect, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'
import { cssColorToHex } from '../../src/renderer/features/titleBar/TitleBar'

/** Mounts the app as main opens a Windows/Linux window: with `chrome=custom` in its URL. */
async function renderCustomChrome(): ReturnType<typeof renderApp> {
  history.replaceState(null, '', `${location.pathname}?chrome=custom`)
  return renderApp()
}
afterEach(() => { history.replaceState(null, '', location.pathname) })

/** The colour a token paints, as the browser computes it. */
function probeColor(token: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

describe('the themed title bar', () => {
  it('is not drawn when the window has the system title bar', async () => {
    await renderApp()
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    expect(document.querySelector('[data-testid="title-bar"]')).toBeNull()
  })

  it('names what is in front, and gives the OS window controls the theme\'s colours', async () => {
    const { fake } = await renderCustomChrome()
    await expect.element(page.getByTestId('title-bar-title')).toHaveTextContent('Apiary')
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('title-bar-title')).toHaveTextContent('Fix CSV export bug — Apiary')
    await expect.poll(() => fake.callsTo('setTitleBarColors').length).toBeGreaterThan(0)
    const [background, symbol] = fake.callsTo('setTitleBarColors')[0] as [string, string]
    expect(background).toMatch(/^#[0-9a-f]{6}$/)
    expect(symbol).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('fills a remote window\'s bar with the accent, so it stands out in the OS window overview', async () => {
    history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=work-box`)
    const { fake } = await renderApp()
    const bar = page.getByTestId('title-bar')
    await expect.element(bar).toHaveAttribute('data-remote', 'true')
    const accent = cssColorToHex(probeColor('--accent'))
    const ink = cssColorToHex(probeColor('--accent-contrast'))
    expect(cssColorToHex(getComputedStyle(bar.element()).backgroundColor)).toBe(accent)
    expect(cssColorToHex(getComputedStyle(page.getByTestId('title-bar-title').element()).color)).toBe(ink)
    await expect.poll(() => fake.callsTo('setTitleBarColors').at(-1)).toEqual([accent, ink])
  })

  it('keeps this machine\'s window bar in the window colour', async () => {
    await renderCustomChrome()
    const bar = page.getByTestId('title-bar')
    await expect.element(bar).toBeVisible()
    expect(bar.element().hasAttribute('data-remote')).toBe(false)
    expect(cssColorToHex(getComputedStyle(bar.element()).backgroundColor)).toBe(cssColorToHex(probeColor('--bg-window')))
  })

  it('draws main\'s menu with its shortcuts, and runs the item that was picked', async () => {
    const { fake } = await renderCustomChrome()
    await userEvent.click(page.getByTestId('menu-bar-file'))
    const dropdown = page.getByTestId('menu-bar-dropdown')
    await expect.element(dropdown).toBeVisible()
    await expect.element(dropdown.getByRole('menuitem', { name: /New Window/ }).getByText('Ctrl+N')).toBeVisible()
    await userEvent.click(dropdown.getByRole('menuitem', { name: /Settings/ }))
    await expect.poll(() => fake.callsTo('appMenuInvoke')).toEqual([[[0, 2]]])
    await expect.element(dropdown).not.toBeInTheDocument()
  })

  it('works from the keyboard: arrows across menus and into a submenu, Escape backs out a level at a time', async () => {
    const { fake } = await renderCustomChrome()
    await userEvent.click(page.getByTestId('menu-bar-file'))
    await userEvent.keyboard('{ArrowRight}')
    const view = page.getByTestId('menu-bar-dropdown')
    await expect.element(view.getByRole('menuitem', { name: /Toggle Sidebar/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{ArrowRight}')
    const sub = page.getByTestId('menu-bar-dropdown-sub')
    await expect.element(sub.getByRole('menuitemcheckbox', { name: /Full Screen/ })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(sub).not.toBeInTheDocument()
    await expect.element(view).toBeVisible()
    await userEvent.keyboard('{ArrowRight}{Enter}')
    await expect.poll(() => fake.callsTo('appMenuInvoke')).toEqual([[[1, 1, 0]]])
  })

  it('turns any computed colour into the #rrggbb the overlay takes', () => {
    expect(cssColorToHex('rgb(27, 28, 30)')).toBe('#1b1c1e')
    expect(cssColorToHex('rgba(255, 0, 16, 0.5)')).toBe('#ff0010')
    expect(cssColorToHex('transparent')).toBeNull()
  })
})
