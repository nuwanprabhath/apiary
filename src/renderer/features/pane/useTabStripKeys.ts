import { useEffect, useRef } from 'react'

/**
 * The strip's keyboard model and scroll-into-view: ArrowLeft/Right/Home/End rove between tabs,
 * Delete closes the focused one, and the active tab is kept whole inside a scrolling strip.
 */
export function useTabStripKeys(
  tabs: { key: string }[],
  activeKey: string | null,
  onActivate: (key: string) => void,
  onClose: (key: string) => void,
) {
  /**
   * Keeps the active tab in view.
   *
   * With enough tabs open the strip scrolls, and the tab you just switched to can be the one off
   * the end of it — visible as a sliver with its close button beyond the edge. Scrolling it into
   * view means the tab being worked in is always whole, whatever is open beside it.
   */
  const activeRef = useRef<HTMLDivElement | null>(null)
  /** Every tab's `role="tab"` button, keyed by tab key, so arrow/Home/End can move DOM focus
   *  once `onActivate` has changed which key is active (see `focusTab`). */
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  /** Set by a keyboard move just before calling `onActivate`; consumed by the effect below so a
   *  mouse click (which also changes `activeKey`) never steals focus onto the tab it activated. */
  const pendingKeyboardFocus = useRef(false)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (pendingKeyboardFocus.current) {
      pendingKeyboardFocus.current = false
      const button = activeKey === null ? undefined : tabButtonRefs.current.get(activeKey)
      button?.focus()
    }
  }, [activeKey, tabs.length])

  const registerButton = (key: string, el: HTMLButtonElement | null): void => {
    if (el !== null) tabButtonRefs.current.set(key, el)
    else tabButtonRefs.current.delete(key)
  }

  /** Moves the roving tab stop to `key` and activates it — the "automatic activation" model the
   *  WAI-ARIA tabs pattern allows, and the simpler of the two here since every tab already
   *  activates on a plain click. Keeps DOM focus and `activeKey` in lockstep, which is what lets
   *  Delete below always mean "close the tab that has focus" without tracking them separately. */
  const focusTab = (key: string): void => {
    pendingKeyboardFocus.current = true
    onActivate(key)
  }

  /** ArrowLeft/Right/Home/End roving focus, and Delete to close the focused tab — the WAI-ARIA
   *  tablist pattern, scoped to this strip's own keydown so it never reaches a focused xterm. */
  const onTabListKeyDown = (e: React.KeyboardEvent): void => {
    if (tabs.length === 0) return
    const current = activeKey === null ? -1 : tabs.findIndex((t) => t.key === activeKey)
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusTab(tabs[(current + 1 + tabs.length) % tabs.length].key)
        return
      case 'ArrowLeft':
        e.preventDefault()
        focusTab(tabs[(current - 1 + tabs.length) % tabs.length].key)
        return
      case 'Home':
        e.preventDefault()
        focusTab(tabs[0].key)
        return
      case 'End':
        e.preventDefault()
        focusTab(tabs[tabs.length - 1].key)
        return
      case 'Delete':
        // No existing shortcut closes a tab (Cmd/Ctrl+W is not bound anywhere in the app), so
        // there is nothing here to collide with — Delete on the focused tab is the tablist
        // pattern's own suggestion and nothing more.
        if (activeKey !== null) { e.preventDefault(); onClose(activeKey) }
        return
      default:
        return
    }
  }

  return { activeRef, registerButton, onTabListKeyDown }
}
