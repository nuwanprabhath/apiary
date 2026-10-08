import type { AppMenuNode } from '@shared/domain/windowChrome'
import { bestEffort, surface } from './policy'

/** The application menu main built, for the themed title bar to draw. No menu is better than a
 *  broken one, so a failed read is logged and answers empty. */
export const readAppMenu = (): Promise<AppMenuNode[]> =>
  bestEffort(window.apiary.appMenu(), 'app').then((menu) => menu ?? [])
/** Runs the menu item at `path`; a failure is shown (the click would otherwise do nothing). */
export function runMenuItem(path: number[]): void {
  surface(window.apiary.appMenuInvoke(path), 'Could not run that menu item')
}
/** The OS-drawn window controls' colours, to match the theme. */
export function setTitleBarColors(background: string, symbol: string): void {
  window.apiary.setTitleBarColors(background, symbol)
}
/** View → Toggle Sidebar. */
export const onToggleSidebar = (cb: () => void): (() => void) => window.apiary.onToggleSidebar(cb)
/** Apiary → Settings… */
export const onOpenSettingsDialog = (cb: () => void): (() => void) => window.apiary.onOpenSettingsDialog(cb)
