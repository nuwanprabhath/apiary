import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

const rows = (): string[] => [...document.querySelectorAll('[data-testid="folder-row"]')].map((r) => r.textContent.trim())
const crumbs = (): string => document.querySelector('[data-testid="folder-crumbs"]')?.textContent ?? ''
const row = (name: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-testid="folder-row"]')].find((r) => r.textContent.trim() === name)
  if (found === undefined) throw new Error(`no row ${name}`)
  return found
}

/** Mounts as main opens a remote window (`remote=<host>` in the URL), then asks for "New session in a folder…". */
async function openBrowser(remote: boolean): ReturnType<typeof renderApp> {
  if (remote) history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=work-box`)
  const mounted = await renderApp()
  await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
  const first = document.querySelector('.project-row-wrap[data-depth="0"]')
  if (first === null) throw new Error('no project row')
  await rightClick(first)
  await userEvent.click(page.getByTestId('context-menu-new-group'))
  await userEvent.keyboard('{Enter}')
  await userEvent.click(page.getByTestId('group-new-session-button'))
  return mounted
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

describe('the folder browser in a remote window', () => {
  it('opens in place of the native picker', async () => {
    const { fake } = await openBrowser(true)
    await expect.element(page.getByTestId('folder-browser')).toBeVisible()
    expect(document.querySelector('#folder-browser-title')?.textContent).toBe('Choose a folder on work-box')
    expect(fake.callsTo('newSessionInPickedFolder')).toHaveLength(0)
    await until(() => rows().length > 0)
    expect(rows()).toEqual(['origin.git', 'picked', 'repo-c', 'repo-c-wt', 'work-a', 'work-b'])
  })

  it('a local window still uses the native picker', async () => {
    const { fake } = await openBrowser(false)
    await expect.poll(() => fake.callsTo('newSessionInPickedFolder').length).toBe(1)
    expect(document.querySelector('[data-testid="folder-browser"]')).toBeNull()
  })

  it('navigates with the mouse: double click enters, a crumb and Up go back', async () => {
    await openBrowser(true)
    await until(() => rows().length > 0)
    await userEvent.dblClick(row('work-a'))
    await until(() => rows().join() === 'src')
    expect(crumbs()).toContain('work-a')
    await expect.element(page.getByTestId('folder-start')).toHaveTextContent('Start session in work-a')
    await userEvent.click(page.getByTestId('folder-up'))
    await until(() => rows().length > 1)
    await expect.element(page.getByTestId('folder-up')).toBeDisabled()
    await userEvent.dblClick(row('work-a'))
    await until(() => rows().join() === 'src')
    await userEvent.click(page.getByTestId('folder-crumb').first())
    await until(() => rows().length > 1)
  })

  it('navigates with the keyboard: arrows select, Enter enters, Backspace goes up, Escape closes', async () => {
    const { fake } = await openBrowser(true)
    await until(() => rows().length > 0)
    await expect.element(page.getByTestId('folder-list')).toHaveFocus()
    for (let i = 0; i < 5; i++) await userEvent.keyboard('{ArrowDown}')
    await expect.poll(() => document.querySelector('[data-testid="folder-row"].selected')?.textContent.trim()).toBe('work-a')
    await userEvent.keyboard('{Enter}')
    await until(() => rows().join() === 'src')
    await userEvent.keyboard('{Backspace}')
    await until(() => rows().length > 1)
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('[data-testid="folder-browser"]') === null)
    expect(fake.callsTo('folderBrowseClose')).toHaveLength(1)
    expect(fake.callsTo('newSessionInBrowsedFolder')).toHaveLength(0)
  })

  it('starts the session in the folder being shown, not the selected child', async () => {
    const { fake } = await openBrowser(true)
    await until(() => rows().length > 0)
    await userEvent.dblClick(row('work-a'))
    await until(() => rows().join() === 'src')
    await userEvent.click(row('src'))
    await userEvent.click(page.getByTestId('folder-start'))
    await expect.poll(() => fake.callsTo('newSessionInBrowsedFolder').length).toBe(1)
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    await until(() => document.querySelector('[data-testid="folder-browser"]') === null)
    // The folder is the one shown (the fake starts in `/fixture/<path>`), which the label names.
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    expect(document.body.textContent).toContain('work-a')
  })

  it('shows a refusal inline and keeps the list', async () => {
    const { fake } = await openBrowser(true)
    await until(() => rows().length > 0)
    fake.override('folderBrowseEnter', async () => { throw new Error('That folder is not here.') })
    await userEvent.dblClick(row('work-a'))
    await expect.element(page.getByTestId('folder-error')).toHaveTextContent('That folder is not here.')
    expect(rows()).toHaveLength(6)
  })
})
