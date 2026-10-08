import { describe, it, expect } from 'vitest'
import { serializeMenu, itemAtPath, type MenuItemLike } from '../../src/main/ipc/menuModel'
import { displayAccelerator } from '@shared/domain/windowChrome'

const item = (o: Partial<MenuItemLike> & { label: string }): MenuItemLike => ({
  type: 'normal', enabled: true, visible: true, checked: false, accelerator: null, role: null, ...o,
})

const MENU: MenuItemLike[] = [
  item({ label: '&File', type: 'submenu', submenu: { items: [
    item({ label: 'New Window', accelerator: 'CmdOrCtrl+N' }),
    item({ label: 'Hidden', visible: false }),
    item({ label: '', type: 'separator' }),
    item({ label: 'Quit', role: 'quit' }),
  ] } }),
  item({ label: 'View', type: 'submenu', submenu: { items: [
    item({ label: 'Full Screen', role: 'togglefullscreen', type: 'checkbox', checked: true }),
  ] } }),
]

describe('the application menu as the themed menu bar draws it', () => {
  it('drops hidden items and mnemonics, formats shortcuts, and fills in a role\'s implicit one', () => {
    const [file, view] = serializeMenu(MENU, false)
    expect(file.label).toBe('File')
    expect(file.submenu?.map((n) => n.label)).toEqual(['New Window', '', 'Quit'])
    expect(file.submenu?.[0].accelerator).toBe('Ctrl+N')
    expect(file.submenu?.[2].accelerator).toBe('Ctrl+Q')
    expect(view.submenu?.[0]).toMatchObject({ kind: 'checkbox', checked: true, accelerator: 'F11' })
  })

  it('finds an item by the same visible-item path the renderer was given', () => {
    expect(itemAtPath(MENU, [0, 2])?.label).toBe('Quit')
    expect(itemAtPath(MENU, [1, 0])?.label).toBe('Full Screen')
    expect(itemAtPath(MENU, [0, 9])).toBeNull()
  })

  it('shows CmdOrCtrl as the platform\'s key', () => {
    expect(displayAccelerator('CmdOrCtrl+Shift+N', false)).toBe('Ctrl+Shift+N')
    expect(displayAccelerator('CommandOrControl+,', true)).toBe('Cmd+,')
  })
})
