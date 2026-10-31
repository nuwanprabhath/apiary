import type { CSSProperties, JSX, ReactNode, Ref } from 'react'

/**
 * A non-modal dialog that floats over the window and stays until its own close button: no
 * backdrop, no focus trap, no Escape and no outside-click close (a `Modal` has all four). The
 * page behind stays usable, so focus moves in and out of it freely; the caller focuses the field
 * the person asked for.
 */
export function FloatingPanel({ ref, label, testId, className, style, children }: {
  ref?: Ref<HTMLDivElement>
  label: string
  testId: string
  className: string
  style?: CSSProperties
  children: ReactNode
}): JSX.Element {
  return (
    <div ref={ref} className={className} role="dialog" aria-modal="false" aria-label={label} data-testid={testId} style={style}>
      {children}
    </div>
  )
}
