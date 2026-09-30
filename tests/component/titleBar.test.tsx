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
