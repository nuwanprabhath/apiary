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
  // The active tab is scrolled into view so it is never a sliver at the end of a scrolling strip.
  const activeRef = useRef<HTMLDivElement | null>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  // Set by a keyboard move, so a mouse click (which also changes `activeKey`) never steals focus.
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

  // Automatic activation (WAI-ARIA tabs): DOM focus and `activeKey` move together, so Delete
  // always closes the focused tab.
  const focusTab = (key: string): void => {
    pendingKeyboardFocus.current = true
    onActivate(key)
  }

  // Scoped to this strip's own keydown so it never reaches a focused xterm.
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
        if (activeKey !== null) { e.preventDefault(); onClose(activeKey) }
        return
      default:
        return
    }
  }

  return { activeRef, registerButton, onTabListKeyDown }
}
