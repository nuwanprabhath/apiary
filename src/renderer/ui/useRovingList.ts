import { type KeyboardEvent, type RefObject, useCallback, useRef } from 'react'

/**
 * Where a navigation key takes the focus among `count` items, or null when the key is not one of
 * ours. `current` is the focused item's index, or -1 when focus is outside the list (a search box
 * above it): ArrowDown then enters at the first item and ArrowUp at the last.
 *
 * The one arithmetic behind every arrow-key list — `Menu`, `useRovingList`, `useListboxNav` — which
 * had four hand-written variants that disagreed on wrapping and on where "no current item" lands.
 */
export function nextIndex(key: string, current: number, count: number, wrap: boolean): number | null {
  if (count === 0) return null
  switch (key) {
    case 'Home': return 0
    case 'End': return count - 1
    case 'ArrowDown':
      if (current === -1) return 0
      return wrap ? (current + 1) % count : Math.min(current + 1, count - 1)
    case 'ArrowUp':
      if (current === -1) return count - 1
      return wrap ? (current - 1 + count) % count : Math.max(current - 1, 0)
    default: return null
  }
}

/** The first of `items` after `current` whose text starts with `typed`, wrapping — a typeahead hit. */
function typeaheadMatch(items: readonly HTMLElement[], current: number, typed: string): HTMLElement | undefined {
  const lower = typed.toLowerCase()
  for (let step = 1; step <= items.length; step++) {
    const candidate = items[(current + step) % items.length]
    if (candidate.textContent.trim().toLowerCase().startsWith(lower)) return candidate
  }
  return undefined
}

interface RovingOptions {
  /** CSS selector for the focusable rows, matched inside the list's root. */
  itemSelector: string
  /** Past the last row, continue at the first (a menu), or stop (a list with a search box above).
   *  Default false. */
  wrap?: boolean
  /** Typing letters jumps to the next row starting with them. Default false: a list that sits under
   *  a search box has its keystrokes spoken for. */
  typeahead?: boolean
}

/** Every enabled row under `root` that matches `selector`, in DOM order. */
function rowsIn(root: HTMLElement, selector: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute('disabled'))
}

/** Moves real DOM focus between `items` for a key press; true if the key was ours. */
export function rovingKeyDown(
  e: KeyboardEvent, items: readonly HTMLElement[], options: { wrap?: boolean },
): boolean {
  const target = nextIndex(e.key, items.indexOf(document.activeElement as HTMLElement), items.length, options.wrap ?? false)
  if (target === null) return false
  e.preventDefault()
  items[target]?.focus()
  return true
}

/**
 * Arrow/Home/End keyboard navigation among the focusable rows of a list — the roving-focus part of
 * the WAI-ARIA list patterns, for lists whose rows are real buttons (the branch pickers). Put the
 * returned `onKeyDown` on the list, and on the search box above it if ArrowDown from there should
 * enter the list. Disabled rows are skipped.
 */
export function useRovingList(
  root: RefObject<HTMLElement | null>, options: RovingOptions,
): { onKeyDown: (e: KeyboardEvent) => void } {
  const latest = useRef(options)
  latest.current = options
  const typed = useRef({ text: '', at: 0 })

  const onKeyDown = useCallback((e: KeyboardEvent): void => {
    const node = root.current
    if (node === null) return
    const { itemSelector, wrap, typeahead } = latest.current
    const rows = rowsIn(node, itemSelector)
    if (rovingKeyDown(e, rows, { wrap })) return
    if (typeahead !== true || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
    // Letters typed in quick succession build one prefix; a pause starts over.
    const now = e.timeStamp
    typed.current = { text: now - typed.current.at > 700 ? e.key : typed.current.text + e.key, at: now }
    const hit = typeaheadMatch(rows, rows.indexOf(document.activeElement as HTMLElement), typed.current.text)
    if (hit === undefined) return
    e.preventDefault()
    hit.focus()
  }, [root])

  return { onKeyDown }
}
