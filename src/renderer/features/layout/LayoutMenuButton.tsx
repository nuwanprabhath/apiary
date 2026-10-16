import { type JSX, useEffect, useRef, type ReactNode } from 'react'
import { LayoutPicker } from './LayoutPicker'
import { useHoverCard } from '../../ui/useHoverCard'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'
import { useLayoutState } from './layoutContext'
import type { PresetId } from '../../state/layout'

interface Props {
  className: string
  testId: string
  title: string
  ariaLabel: string
  onClick?: () => void
  /** Called as the picker appears, so whatever else the pointer opened on the way (the row's
   *  hover card) gets out of its way. */
  onOpen?: () => void
  heading: string
  mode?: 'place' | 'layout'
  onPick: (preset: PresetId, zone: number) => void
  children: ReactNode
  /** Unset by default (a normal Tab stop); a row inside a WAI-ARIA tree passes -1 so only the
   *  row's treeitem is one. */
  tabIndex?: number
}

/** Without an `onClick`, a click opens the picker. */
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
  // Whether the current open is a click rather than the pointer resting: it decides whether
  // `LayoutPicker` takes keyboard focus. Reset on `mouseenter` so a later hover-open is not stale.
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
          onClose={() => { hover.hideNow(); focusUnlessTyping(hover.ref.current) }}
          onPointerEnter={hover.keepOpen}
          onPointerLeave={hover.scheduleClose}
        />
      )}
    </>
  )
}
