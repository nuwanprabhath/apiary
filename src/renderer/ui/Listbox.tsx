import { createElement, type HTMLAttributes, type JSX, type KeyboardEvent, type Ref, useCallback, useRef } from 'react'
import { nextIndex } from './useRovingList'

type ListboxProps = Omit<HTMLAttributes<HTMLElement>, 'role' | 'aria-activedescendant' | 'aria-label'> & {
  /** What the list is, for a screen reader. */
  label: string
  /** The id of the option that is current. Set it here when the listbox itself has the focus; when
   *  a search box has it (a combobox), put `aria-activedescendant` on that input instead. */
  activeId?: string
  as?: 'div' | 'ul'
  ref?: Ref<HTMLElement>
  testId?: string
}

/**
 * A `role="listbox"`: options named by id and followed with `aria-activedescendant`, so assistive
 * technology tracks the arrow keys while keyboard focus stays on one element (a search box, or the
 * list itself). Pair it with `useListboxNav` for the keys; rows are `role="option"` with an `id`
 * from `optionId` and `aria-selected` for the current one.
 *
 * The widget roles live in `ui/` so a listbox is never announced without the keys it promises —
 * `ModeMenu` and `ModelPicker` once declared `role="menu"` and handled none.
 */
export function Listbox({ label, activeId, as = 'div', ref, testId, ...rest }: ListboxProps): JSX.Element {
  return createElement(as, {
    role: 'listbox',
    'aria-label': label,
    'aria-activedescendant': activeId,
    'data-testid': testId,
    ref,
    ...rest,
  })
}

/** The DOM id of option `index` in the listbox `base`, for `aria-activedescendant`. */
export function optionId(base: string, index: number): string {
  return `${base}-option-${String(index)}`
}

interface NavOptions {
  count: number
  /** The current option's index, or -1 for none. */
  active: number
  setActive: (index: number) => void
  /** Enter on the current option. Called with the key event so a caller can add its own rule when
   *  nothing is current. */
  onChoose?: (e: KeyboardEvent) => void
  /** Also handle Home and End. Off for a search box, where they move the caret. */
  edges?: boolean
}

/**
 * ArrowUp/ArrowDown (and Home/End, Enter) for a listbox whose current option is a piece of state
 * rather than DOM focus. Stops at the ends instead of wrapping, like every list of this kind here.
 */
export function useListboxNav(options: NavOptions): { onKeyDown: (e: KeyboardEvent) => void } {
  const latest = useRef(options)
  latest.current = options
  const onKeyDown = useCallback((e: KeyboardEvent): void => {
    const { count, active, setActive, onChoose, edges = false } = latest.current
    if (e.key === 'Enter') {
      if (onChoose === undefined) return
      e.preventDefault()
      onChoose(e)
      return
    }
    if (!edges && (e.key === 'Home' || e.key === 'End')) return
    const next = nextIndex(e.key, active, count, false)
    if (next === null) return
    e.preventDefault()
    setActive(next)
  }, [])
  return { onKeyDown }
}
