import { BrowserWindow, Menu, type KeyboardEvent, type MenuItem, type WebContents } from 'electron'
import { isHexColor } from '@shared/domain/windowChrome'
import { serializeMenu, itemAtPath } from '../../app/menuModel'
import { TITLE_BAR_HEIGHT } from '../../windows/windowManager'
import type { Handlers, Listeners } from '../registrar'

type HandledKeys = 'appMenu' | 'appMenuInvoke'
type ListenedKeys = 'setTitleBarColors'

/**
 * The themed title bar's two needs from main: the application menu to draw (and a way to run an
 * item from it), and a way to colour the OS-drawn window controls that sit over the bar.
 */
export function appChromeHandlers(): { handlers: Pick<Handlers, HandledKeys>; listeners: Pick<Listeners, ListenedKeys> } {
  const isMac = process.platform === 'darwin'
  return {
    handlers: {
      appMenu: () => serializeMenu(Menu.getApplicationMenu()?.items ?? [], isMac),
      // Clicks the very item the native menu would have, so a role (Copy, Toggle DevTools, Quit)
      // does exactly what it always did — Electron's own click wrapper runs the role — against the
      // window that asked.
      appMenuInvoke: (e, path) => {
        const item = itemAtPath<MenuItem>(Menu.getApplicationMenu()?.items ?? [], path)
        if (item === null || !item.enabled || item.submenu !== undefined && item.submenu !== null && item.submenu.items.length > 0) return
        const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
        // Electron types `click` as a bare `Function`; this is the signature it calls it with.
        const click = item.click as (event: KeyboardEvent, window?: BrowserWindow, contents?: WebContents) => void
        click({ triggeredByAccelerator: false }, win, e.sender)
      },
    },
    listeners: {
      setTitleBarColors: (e, background, symbol) => {
        if (process.platform === 'darwin' || !isHexColor(background) || !isHexColor(symbol)) return
        const win = BrowserWindow.fromWebContents(e.sender)
        try {
          win?.setTitleBarOverlay({ color: background, symbolColor: symbol, height: TITLE_BAR_HEIGHT })
        } catch {
          // A window with the system title bar has no overlay to colour.
        }
      },
    },
  }
}
