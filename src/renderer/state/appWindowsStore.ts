import type { AppWindowInfo } from '@shared/domain/appWindows'
import { createIpcStore } from './createIpcStore'
import { createLocalStore } from './createLocalStore'
import { background } from './policy'

/** This machine's Apiary windows, for the status bar's window buttons, kept live. */
const appWindowsStore = createIpcStore<AppWindowInfo[]>({
  scope: 'window',
  initial: [],
  fetch: () => window.apiary.appWindows(),
  subscribe: (_push, invalidate) => window.apiary.onAppWindowsChanged(invalidate),
})

export function useAppWindows(): AppWindowInfo[] {
  return appWindowsStore.useStore()
}

/** Brings a window to the front; the bar shows it focused once main says so. */
export function bringWindowToFront(windowNumber: number): void {
  background(window.apiary.appWindowRaise(windowNumber), 'window')
}

/** How often an open preview is taken again: often enough to see a reply come in, rarely enough to cost nothing. */
const PREVIEW_EVERY_MS = 1500

/** The last picture of each window whose preview is open, by window number. */
const previews = createLocalStore<Readonly<Record<number, string | null>>>({})

export function useAppWindowPreview(windowNumber: number): string | null | undefined {
  return previews.useStore((all) => all[windowNumber])
}

/**
 * Takes a picture of a window now and again while its preview is open, as a taskbar thumbnail
 * follows the window it shows. Returns the stop, which forgets the picture.
 */
export function watchAppWindowPreview(windowNumber: number): () => void {
  let stopped = false
  const take = (): void => {
    background(window.apiary.appWindowPreview(windowNumber).then((picture) => {
      if (!stopped) previews.set((all) => ({ ...all, [windowNumber]: picture }))
    }), 'window')
  }
  take()
  const timer = window.setInterval(take, PREVIEW_EVERY_MS)
  return () => {
    stopped = true
    window.clearInterval(timer)
    previews.set((all) => {
      const { [windowNumber]: _gone, ...rest } = all
      return rest
    })
  }
}
