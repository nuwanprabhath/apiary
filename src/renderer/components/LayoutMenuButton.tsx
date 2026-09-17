import type { ReactNode } from 'react'
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
  className, testId, title, ariaLabel, onClick, heading, mode = 'place', onPick, children,
}: Props): JSX.Element {
  const { preset } = useLayoutActions()
  const hover = useHoverCard<HTMLButtonElement>()
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
