import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'

/**
 * The shared `.pinned-header` button — chevron, label, count — behind Active, Pinned and Recent.
 * The folder-group header has extra drag handlers and a different label class, so it does not use
 * this; it still reuses `ChevronIcon`. `badge` sits before the count and `hover` carries the
 * pointer/focus handlers Active uses to open its legend.
 */
export function SectionHeader(
  { testId, label, count, expanded, onToggle, badge, className, hover }: {
    testId: string
    label: string
    count: number
    expanded: boolean
    onToggle: () => void
    badge?: ReactNode
    className?: string
    hover?: Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur'>
  },
): JSX.Element {
  return (
    <button
      className={className === undefined ? 'pinned-header' : `pinned-header ${className}`}
      data-testid={testId}
      aria-expanded={expanded}
      onClick={onToggle}
      {...hover}
    >
      <ChevronIcon expanded={expanded} />
      <span className="pinned-label">{label}</span>
      {badge}
      <span className="pinned-count">{count}</span>
    </button>
  )
}
