import { useEffect, useRef, type ReactNode } from 'react'
import { LayoutPicker } from './LayoutPicker'
import { useHoverCard } from './useHoverCard'
import { useLayoutActions } from '../state/layoutContext'
import type { PresetId } from '../state/layout'

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
}

/**
 * A button that still does its own job on click, and offers the layout picker when the pointer
 * rests on it — the green-button gesture from macOS. Without an `onClick`, a click opens the
 * picker straight away.
 */
export function LayoutMenuButton({
  className, testId, title, ariaLabel, onClick, onOpen, heading, mode = 'place', onPick, children,
}: Props): JSX.Element {
  const { preset } = useLayoutActions()
  // The row the button sits in counts as part of the picker's hover region — see `safeWithin`.
  const hover = useHoverCard<HTMLButtonElement>({ safeWithin: '.session-row-wrap' })
  // Fires on the transition into "open", not on every render while open.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (hover.anchor !== null && !wasOpen.current) onOpen?.()
    wasOpen.current = hover.anchor !== null
  }, [hover.anchor, onOpen])
  return (
    <>
      <button
        ref={hover.ref}
        className={className}
        data-testid={testId}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onMouseEnter={hover.arm}
        onMouseLeave={hover.scheduleClose}
        onClick={(e) => {
          e.stopPropagation()
          if (onClick === undefined) { hover.openNow(); return }
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
          onPick={(p, z) => { hover.hideNow(); onPick(p, z) }}
          onClose={() => { hover.hideNow(); hover.ref.current?.focus() }}
          onPointerEnter={hover.keepOpen}
          onPointerLeave={hover.scheduleClose}
        />
      )}
    </>
  )
}
