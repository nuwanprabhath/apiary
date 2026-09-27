import { type JSX, useEffect, useRef, type ReactNode } from 'react'
import { LayoutPicker } from './LayoutPicker'
import { useHoverCard } from '../../ui/useHoverCard'
import { useLayoutState } from './layoutContext'
import type { PresetId } from './layout'

interface Props {
  className: string
  testId: string
  title: string
  ariaLabel: string
  /** What a plain click does — the button's job before the picker existed. */
  onClick?: () => void
  /** Called as the picker appears, so whatever else the pointer opened on the way here (the row's
   *  own hover card) can get out of its way. Two popups from one gesture, overlapping each other,
   *  is not a menu — it is a mess. */
  onOpen?: () => void
  heading: string
  mode?: 'place' | 'layout'
  onPick: (preset: PresetId, zone: number) => void
  children: ReactNode
  /** UI-27: unset by default (a normal Tab stop); a row inside a WAI-ARIA tree passes -1 so only
   *  the row's own treeitem is one, reached instead through its context menu. */
  tabIndex?: number
}

/**
 * A button that still does its own job on click, and offers the layout picker when the pointer
 * rests on it — the green-button gesture from macOS. Without an `onClick`, a click opens the
 * picker straight away.
 */
export function LayoutMenuButton({
  className, testId, title, ariaLabel, onClick, onOpen, heading, mode = 'place', onPick, children,
  tabIndex,
}: Props): JSX.Element {
  const { preset } = useLayoutState()
  // The row the button sits in counts as part of the picker's hover region — see `safeWithin`.
  const hover = useHoverCard<HTMLButtonElement>({ safeWithin: '.session-row-wrap' })
  // Fires on the transition into "open", not on every render while open.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (hover.anchor !== null && !wasOpen.current) onOpen?.()
    wasOpen.current = hover.anchor !== null
  }, [hover.anchor, onOpen])
  // Whether the *current* open (if any) is this click, as opposed to the pointer merely resting on
  // the button — the only distinction `LayoutPicker` needs to decide whether to take keyboard focus
  // (UI-28). Reset on every `mouseenter` so a later hover-open after a earlier click-open does not
  // inherit a stale `true`.
  const openedByClickRef = useRef(false)
  return (
    <>
      <button
        ref={hover.ref}
        className={className}
        data-testid={testId}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        tabIndex={tabIndex}
        onMouseEnter={() => { openedByClickRef.current = false; hover.arm() }}
        onMouseLeave={hover.scheduleClose}
        onClick={(e) => {
          e.stopPropagation()
          if (onClick === undefined) { openedByClickRef.current = true; hover.openNow(); return }
          hover.hideNow()
          onClick()
        }}
      >
        {children}
      </button>
      {hover.anchor !== null && (
        <LayoutPicker
          anchor={hover.anchor}
          mode={mode}
          heading={heading}
          current={preset}
          focusOnOpen={openedByClickRef.current}
          onPick={(p, z) => { hover.hideNow(); onPick(p, z) }}
          onClose={() => { hover.hideNow(); hover.ref.current?.focus() }}
          onPointerEnter={hover.keepOpen}
          onPointerLeave={hover.scheduleClose}
        />
      )}
    </>
  )
}
