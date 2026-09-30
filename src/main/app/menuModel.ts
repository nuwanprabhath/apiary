import type { AppMenuNode } from '@shared/domain/windowChrome'
import { displayAccelerator } from '@shared/domain/windowChrome'

/** The shape of an Electron `MenuItem` this reads — structural, so it is testable without Electron. */
export interface MenuItemLike {
  label: string
  type: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio' | 'header' | 'palette'
  /** Null on an item with no role, as Electron reports it. */
  role?: string | null
  accelerator?: string | null
  enabled: boolean
  visible: boolean
  checked: boolean
  submenu?: { items: MenuItemLike[] } | null
}

/**
 * The shortcuts Electron gives a role item without saying so: a role's `accelerator` is empty
 * unless set explicitly, but the key still works — and a menu drawn without it would hide it.
 * Linux/Windows values (the custom menu bar only exists there).
 */
const ROLE_ACCELERATORS: Record<string, string> = {
  undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z', cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V',
  pasteandmatchstyle: 'Ctrl+Shift+V', selectall: 'Ctrl+A', toggledevtools: 'Ctrl+Shift+I',
  togglefullscreen: 'F11', minimize: 'Ctrl+M', close: 'Ctrl+W', quit: 'Ctrl+Q', reload: 'Ctrl+R',
}

/** The application menu as data for the renderer's menu bar. Hidden items are left out. */
export function serializeMenu(items: MenuItemLike[], isMac: boolean): AppMenuNode[] {
  return items.filter((i) => i.visible).map((i) => {
    const kind: AppMenuNode['kind'] = i.type === 'separator' ? 'separator'
      : i.type === 'checkbox' ? 'checkbox'
        : i.type === 'radio' ? 'radio'
          : i.submenu !== undefined && i.submenu !== null && i.submenu.items.length > 0 ? 'submenu' : 'normal'
    const accel = i.accelerator ?? (typeof i.role === 'string' ? ROLE_ACCELERATORS[i.role.toLowerCase()] : undefined)
    return {
      label: i.label.replace(/&/g, ''),
      kind,
      enabled: i.enabled,
      ...(accel !== undefined && accel !== '' && kind !== 'submenu' ? { accelerator: displayAccelerator(accel, isMac) } : {}),
      ...(kind === 'checkbox' || kind === 'radio' ? { checked: i.checked } : {}),
      ...(kind === 'submenu' ? { submenu: serializeMenu(i.submenu?.items ?? [], isMac) } : {}),
    }
  })
}

/** The item at `path` (indices through the *visible* items, as `serializeMenu` numbered them). */
export function itemAtPath<T extends MenuItemLike>(items: T[], path: readonly number[]): T | null {
  let level: MenuItemLike[] = items
  let found: MenuItemLike | null = null
  for (const index of path) {
    const visible = level.filter((i) => i.visible)
    found = visible[index] ?? null
    if (found === null) return null
    level = found.submenu?.items ?? []
  }
  return found as T | null
}
