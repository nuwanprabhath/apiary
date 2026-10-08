import { describe, it, expect, afterEach, onTestFinished } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { fakePet } from './fakeApiary'
import { sidebarSession, until } from './helpers'
import { expectConsoleError } from './setup'
import { THEME_CHANGE_EVENT } from '../../src/renderer/theme/applyTheme'
import { BUILTIN_THEMES } from '@shared/theme/builtins'

/**
 * UI-24 / B11: the window's other regions each fail inside their own boundary. Before, ThemeEffects,
 * TitleBar, UpdateBanner, StatusBar, PetLayer and the New worktree / folder Change branch / Arrange
 * dialogs sat under only the root boundary, so one render fault in any of them replaced the whole
 * window (sidebar, panes, terminals) with the crash pane. Each test makes one of them throw with
 * data it could really receive, and asserts the rest of the window is still there.
 *
 * The architecture test (tests/unit/architecture/errorBoundaries.test.ts) keeps a region from being
 * added without a boundary; this proves the boundaries each region got actually contain a fault.
 */

afterEach(() => { history.replaceState(null, '', location.pathname) })

/** A session open in a pane and the sidebar beside it: what a fault elsewhere must not take down. */
async function expectWindowIntact(): Promise<void> {
  await expect.element(page.getByTestId('sidebar')).toBeVisible()
  await expect.element(page.getByTestId('transcript')).toBeVisible()
}

async function openSession(): Promise<void> {
  await userEvent.click(sidebarSession('Fix CSV export bug'))
  await expect.element(page.getByTestId('transcript')).toBeVisible()
}

/** The user is told which region failed, so a vanished layer is not a silent mystery. */
async function expectToldAbout(what: string): Promise<void> {
  await expect.element(page.getByTestId('notification').first()).toMatchTextContent(`${what} could not be displayed`)
}

function folderRow(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
  if (row === undefined) throw new Error(`no folder row ${label}`)
  return row
}

function rightClick(el: Element): void {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2 }))
}

describe('a fault in one region of the window stays in that region (UI-24)', () => {
  it('the status bar: a malformed item shows a one-line fallback with a retry, not a blank window', async () => {
    expectConsoleError(/Objects are not valid as a React child/)
    const bad = { pluginId: 'p', id: 'bad', icon: 'gauge', text: { not: 'text' }, title: 't', tone: 'normal', action: { kind: 'none' }, detail: [] } as never
    await renderApp({ statusBar: [bad] })
    await expect.element(page.getByTestId('crash-strip')).toBeVisible()
    await expect.element(page.getByTestId('crash-strip')).toMatchTextContent('The status bar could not be displayed')
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
    await expect.element(page.getByTestId('crash-retry')).toBeVisible()
  })

  it('the update banner: a malformed status shows a one-line fallback, and the window is intact', async () => {
    expectConsoleError(/replace is not a function/)
    await renderApp({ update: { phase: 'available', availableVersion: 5 as never } })
    await expect.element(page.getByTestId('crash-strip')).toMatchTextContent('The update banner could not be displayed')
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
  })

  it('the title bar: a malformed application menu shows a one-line fallback, and the window is intact', async () => {
    expectConsoleError(/toLowerCase is not a function/)
    history.replaceState(null, '', `${location.pathname}?chrome=custom`)
    await renderApp({}, (fake) => {
      fake.override('appMenu', async () => [{ label: 5 as never, kind: 'submenu', enabled: true, submenu: [] }])
    })
    await expect.element(page.getByTestId('crash-strip')).toMatchTextContent('The title bar could not be displayed')
    await expect.element(page.getByTestId('sidebar')).toBeVisible()
  })

  it('the pets layer: a malformed pet removes the layer and says so, and the window is intact', async () => {
    expectConsoleError(/Cannot read properties of undefined/)
    const { fake } = await renderApp()
    await openSession()
    fake.state.pets = { enabled: true, generating: false, pets: [fakePet('pip', { spec: undefined as never })] }
    fake.emit('petsChanged', fake.state.pets)
    await expectToldAbout('The pets')
    expect(document.querySelector('[data-testid="pet-layer"]')).toBeNull()
    await expectWindowIntact()
  })

  it('the effects layer: an unknown effect removes the layer and says so, and the window is intact', async () => {
    expectConsoleError(/Cannot read properties of undefined/)
    await renderApp()
    await openSession()
    const spec = { ...BUILTIN_THEMES[0].spec, effects: [{ kind: 'no-such-effect' }] }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: spec }))
    await expectToldAbout('The theme effects')
    expect(document.querySelector('[data-testid="crash-pane"]')).toBeNull()
    await expectWindowIntact()
  })

  it('the arrange picker: a fault shows a dialog fallback that closes, and the window is intact', async () => {
    expectConsoleError(/DELIBERATE_PICKER_CRASH/)
    await renderApp()
    await openSession()
    rightClick(document.querySelector('[data-testid="session-tab"]')!)
    await until(() => document.querySelector('[data-testid="context-menu-arrange"]') !== null)
    // eslint-disable-next-line @typescript-eslint/unbound-method -- saved to be restored and called with the right `this` below
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
      if (this.matches('[data-testid="layout-picker"]')) throw new Error('DELIBERATE_PICKER_CRASH')
      return original.call(this)
    }
    onTestFinished(() => { Element.prototype.getBoundingClientRect = original })
    await userEvent.click(page.getByTestId('context-menu-arrange'))
    await expect.element(page.getByTestId('dialog-crash')).toBeVisible()
    await expectWindowIntact()
    await userEvent.click(page.getByTestId('dialog-crash-close'))
    await expect.element(page.getByTestId('dialog-crash')).not.toBeInTheDocument()
  })

  it('the New worktree dialog: a fault shows a dialog fallback that closes, and the window is intact', async () => {
    expectConsoleError(/toLowerCase is not a function/)
    await renderApp({}, (fake) => {
      fake.override('worktreeCreateOptions', async (path) => ({ parentDir: `${path}.worktrees`, existingNames: [], local: [5 as never], remote: [], checkedOut: [] }))
    })
    await openSession()
    await userEvent.click(folderRow('repo-c').querySelector<HTMLElement>('[data-testid="new-session-button"]')!)
    await userEvent.click(page.getByTestId('context-menu-new-worktree'))
    await expect.element(page.getByTestId('dialog-crash')).toBeVisible()
    await expectWindowIntact()
    await userEvent.click(page.getByTestId('dialog-crash-close'))
    await expect.element(page.getByTestId('dialog-crash')).not.toBeInTheDocument()
  })

  it('the folder Change branch dialog: a fault shows a dialog fallback that closes, and the window is intact', async () => {
    expectConsoleError(/toLowerCase is not a function|is not a function|Cannot read properties/)
    await renderApp({ refs: { current: 'feature/wt', local: [null as never] } })
    await openSession()
    folderRow('repo-c-wt').focus()
    rightClick(folderRow('repo-c-wt'))
    await userEvent.click(page.getByTestId('context-menu-change-branch'))
    await expect.element(page.getByTestId('dialog-crash')).toBeVisible()
    await expectWindowIntact()
    await userEvent.click(page.getByTestId('dialog-crash-close'))
    await expect.element(page.getByTestId('dialog-crash')).not.toBeInTheDocument()
  })
})
