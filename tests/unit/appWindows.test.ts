import { describe, it, expect, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({ app: { on: vi.fn(), off: vi.fn() } }))
const { listAppWindows, raiseAppWindow } = await import('../../src/main/windows/appWindows')

interface Win { number: number; title: string; focused?: boolean; minimized?: boolean; visible?: boolean; remote?: string }

/** A stand-in BrowserWindow with what the window buttons read and do, recording what was done. */
function window(w: Win, did: string[]): BrowserWindow {
  const url = `file:///index.html?w=${String(w.number)}${w.remote === undefined ? '' : `&remote=${w.remote}`}`
  return {
    isDestroyed: () => false,
    getTitle: () => w.title,
    isFocused: () => w.focused === true,
    isMinimized: () => w.minimized === true,
    isVisible: () => w.visible !== false,
    restore: () => { did.push(`restore ${String(w.number)}`) },
    focus: () => { did.push(`focus ${String(w.number)}`) },
    webContents: { getURL: () => url },
  } as unknown as BrowserWindow
}

const deps = (wins: Win[], did: string[] = []) => {
  const all = wins.map((w) => window(w, did))
  return { all: () => all, numberOf: (b: BrowserWindow) => Number(new URL(b.webContents.getURL()).searchParams.get('w')) }
}

describe('the window buttons\' windows', () => {
  it('lists them in window order, which getAllWindows is not, by their title less " — Apiary"', () => {
    const list = listAppWindows(deps([
      { number: 3, title: 'Review MR — work-box — Apiary', remote: 'work-box' },
      { number: 1, title: 'Fix CSV export bug — Apiary', focused: true },
      { number: 2, title: 'Apiary', minimized: true },
    ]))
    expect(list).toEqual([
      { number: 1, title: 'Fix CSV export bug', focused: true, minimized: false, remoteHost: null },
      { number: 2, title: 'Apiary', focused: false, minimized: true, remoteHost: null },
      { number: 3, title: 'Review MR — work-box', focused: false, minimized: false, remoteHost: 'work-box' },
    ])
  })

  it('raises a window, restoring a minimised one, and leaves one that was never shown hidden', () => {
    const did: string[] = []
    const d = deps([{ number: 1, title: 'a' }, { number: 2, title: 'b', minimized: true, visible: false }, { number: 3, title: 'c', visible: false }], did)
    raiseAppWindow(d, 1)
    raiseAppWindow(d, 2)
    raiseAppWindow(d, 3)
    raiseAppWindow(d, 9)
    expect(did).toEqual(['focus 1', 'restore 2', 'focus 2'])
  })
})
