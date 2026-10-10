import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { ContextMenuRequest } from '@shared/domain/contextMenu'
import { renderApp } from './renderApp'
import { fakePet } from './fakeApiary'
import { sessionRow, sidebarSession, stays, until } from './helpers'

const ALL_EDITS = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }

function request(over: Partial<ContextMenuRequest> = {}): ContextMenuRequest {
  return {
    x: 320,
    y: 240,
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    editFlags: ALL_EDITS,
    ...over,
  }
}

function rightClick(el: Element): void {
  const { left, top, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: left + width / 2, clientY: top + height / 2,
  }))
}

function itemLabels(testId: string): string[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"] [role="menuitem"]`)]
    .map((el) => el.textContent ?? '')
}

describe('spelling and text context menus', () => {
  it('A right-click on selected read-only text shows a menu with Copy enabled, and Cut/Paste absent or disabled', async () => {
    const { fake } = await renderApp()
    const note = document.createElement('p')
    note.textContent = 'Read only words'
    document.body.appendChild(note)
    try {
      const range = document.createRange()
      range.selectNodeContents(note)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      rightClick(note)
      fake.emit('contextMenuRequested', request({
        selectionText: 'Read only words',
        editFlags: { canCut: false, canCopy: true, canPaste: false, canSelectAll: true },
      }))
      await until(() => document.querySelector('[data-testid="text-menu"]') !== null)
      expect(document.querySelector<HTMLButtonElement>('[data-testid="context-menu-copy"]')?.disabled).toBe(false)
      for (const id of ['cut', 'paste']) {
        const item = document.querySelector<HTMLButtonElement>(`[data-testid="context-menu-${id}"]`)
        expect(item === null || item.disabled).toBe(true)
      }
    } finally {
      note.remove()
    }
  })

  it('A right-click in the message box (the fake emits `contextMenuRequested` with `isEditable: true`) shows Cut, Copy, Paste and Select all', async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    rightClick(page.getByTestId('composer-input').element())
    fake.emit('contextMenuRequested', request({ isEditable: true }))
    await until(() => document.querySelector('[data-testid="text-menu"]') !== null)
    expect(itemLabels('text-menu')).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
  })

  it('With a `misspelledWord`, a "Spelling" submenu lists the suggestions, and choosing one sends `editCommand` replaceMisspelling with that word', async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    rightClick(page.getByTestId('composer-input').element())
    fake.emit('contextMenuRequested', request({
      isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tea'],
    }))
    await until(() => document.querySelector('[data-testid="text-menu"]') !== null)
    await userEvent.click(page.getByTestId('context-menu-spelling'))
    await expect.element(page.getByTestId('context-submenu')).toBeVisible()
    expect(itemLabels('context-submenu')).toEqual(['the', 'ten', 'tea'])
    await userEvent.click(page.getByTestId('context-menu-spell-0'))
    await until(() => fake.callsTo('editCommand').length > 0)
    expect(fake.callsTo('editCommand')).toEqual([[{ action: 'replaceMisspelling', word: 'the' }]])
  })

  it("A left-click on a word the fake's `spellingCheck` marks misspelled shows its suggestions; choosing one replaces the word in the textarea's value", async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const box = page.getByTestId('composer-input')
    await userEvent.type(box, 'teh')
    await userEvent.click(box)
    await expect.element(page.getByTestId('spelling-menu')).toBeVisible()
    expect(itemLabels('spelling-menu')).toEqual(['the', 'ten', 'tea'])
    await userEvent.click(page.getByTestId('context-menu-spell-0'))
    await expect.element(box).toHaveValue('the')
  })

  it('the left-click suggestions close on Escape, and on a click elsewhere', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    const box = page.getByTestId('composer-input')
    await userEvent.type(box, 'teh')
    await userEvent.click(box)
    await expect.element(page.getByTestId('spelling-menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('[data-testid="spelling-menu"]') === null)
    await userEvent.click(box)
    await expect.element(page.getByTestId('spelling-menu')).toBeVisible()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => document.querySelector('[data-testid="spelling-menu"]') === null)
    await stays(() => document.querySelector('[data-testid="spelling-menu"]') === null, 300, 'the suggestions stay closed')
  })

  it("A sidebar row's own context menu still opens (no app text menu over it)", async () => {
    const { fake } = await renderApp()
    const row = await sessionRow('Fix CSV export bug')
    rightClick(row)
    await until(() => document.querySelector('[data-testid="sidebar-menu"]') !== null)
    fake.emit('contextMenuRequested', request({ selectionText: 'Fix CSV export bug' }))
    await stays(() => document.querySelector('[data-testid="text-menu"]') === null, 300, 'no app text menu over the row')
    expect(document.querySelector('[data-testid="sidebar-menu"]')).not.toBeNull()
  })

  it("a session tab's own context menu still opens, with no app text menu over it", async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => document.querySelector('[data-testid="session-tab"]') !== null)
    rightClick(document.querySelector('[data-testid="session-tab"]')!)
    fake.emit('contextMenuRequested', request({ selectionText: 'Fix CSV export bug' }))
    await until(() => document.querySelector('[data-testid="tab-menu"]') !== null)
    await stays(() => document.querySelector('[data-testid="text-menu"]') === null, 300, 'no app text menu over the tab')
  })

  it("a folder's own context menu still opens, with no app text menu over it", async () => {
    const { fake } = await renderApp()
    await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
    rightClick(document.querySelector('.project-row-wrap[data-depth="0"]')!)
    fake.emit('contextMenuRequested', request({ selectionText: 'work-a' }))
    await until(() => document.querySelector('[data-testid="sidebar-menu"]') !== null)
    await stays(() => document.querySelector('[data-testid="text-menu"]') === null, 300, 'no app text menu over the folder')
  })

  it("a folder group's own context menu still opens, with no app text menu over it", async () => {
    const { fake } = await renderApp()
    await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
    rightClick(document.querySelector('.project-row-wrap[data-depth="0"]')!)
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.keyboard('{Enter}')
    await until(() => document.querySelector('[data-testid="folder-group-toggle"]') !== null)
    rightClick(document.querySelector('[data-testid="folder-group-toggle"]')!)
    fake.emit('contextMenuRequested', request({ selectionText: 'Group' }))
    await until(() => document.querySelector('[data-testid="sidebar-menu"]') !== null)
    await stays(() => document.querySelector('[data-testid="text-menu"]') === null, 300, 'no app text menu over the group heading')
  })

  it("a right-click in a folder group's rename field leaves the browser's menu alone, and the text menu opens without ending the rename", async () => {
    const { fake } = await renderApp()
    await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
    rightClick(document.querySelector('.project-row-wrap[data-depth="0"]')!)
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await until(() => document.querySelector('[data-testid="folder-group-rename"]') !== null)
    const field = document.querySelector<HTMLElement>('[data-testid="folder-group-rename"]')!
    const { x, y, width, height } = field.getBoundingClientRect()
    const browserMenuAllowed = field.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
    }))
    expect(browserMenuAllowed).toBe(true)
    fake.emit('contextMenuRequested', request({ isEditable: true }))
    await until(() => document.querySelector('[data-testid="text-menu"]') !== null)
    expect(itemLabels('text-menu')).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
    await stays(() => document.querySelector('[data-testid="folder-group-rename"]') !== null, 300, 'the rename stays open under its menu')
    expect(document.querySelector('[data-testid="sidebar-menu"]')).toBeNull()
  })

  it("a pet's own context menu still opens, with no app text menu over it", async () => {
    const { fake } = await renderApp()
    fake.state.pets = { enabled: true, generating: false, pets: [fakePet('pip', { size: 64 })] }
    fake.emit('petsChanged', fake.state.pets)
    await until(() => document.querySelector('[data-testid="pet"]') !== null)
    rightClick(document.querySelector('[data-testid="pet"]')!)
    fake.emit('contextMenuRequested', request({ selectionText: 'pip' }))
    await until(() => document.querySelector('[data-testid="pet-menu"]') !== null)
    await stays(() => document.querySelector('[data-testid="text-menu"]') === null, 300, 'no app text menu over the pet')
  })

  it("a terminal's own context menu still opens, with no app text menu over it", async () => {
    const { fake } = await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await userEvent.click(page.getByTestId('shell-toggle'))
    await expect.element(page.getByTestId('terminal-shell')).toBeVisible()
    rightClick(page.getByTestId('terminal-shell').element())
    fake.emit('contextMenuRequested', request({ selectionText: 'ls' }))
    await until(() => document.querySelector('[data-testid="terminal-menu"]') !== null)
    await stays(() => document.querySelector('[data-testid="text-menu"]') === null, 300, 'no app text menu over the terminal')
  })
})
