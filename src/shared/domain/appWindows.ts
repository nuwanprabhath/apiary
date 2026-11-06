/** One of this machine's Apiary windows, for the status bar's window buttons (`appWindows`). */
export interface AppWindowInfo {
  /** The window number every window's URL carries (`w=`); a window's own is `windowNumber()`. */
  number: number
  /** What its page calls itself: the active tab's title, or "Apiary" with no tab open. */
  title: string
  focused: boolean
  minimized: boolean
  /** The work machine a remote window shows; null for this machine's own. */
  remoteHost: string | null
}

/** What every page's title ends with (`useWindowTitle`); the buttons show the part before it. */
export const TITLE_SUFFIX = ' — Apiary'
