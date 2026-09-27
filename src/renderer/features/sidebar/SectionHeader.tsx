import type { JSX } from 'react'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'

/**
 * The shared `.pinned-header` button — chevron, label, count — behind Pinned and Recent (UI-19).
 * Active has no chevron (it cannot be collapsed) and the folder-group header has extra drag
 * handlers and a different label class, so neither uses this; both still reuse `ChevronIcon`.
 */
export function SectionHeader(
  { testId, label, count, expanded, onToggle }: {
    testId: string
    label: string
    count: number
    expanded: boolean
    onToggle: () => void
  },
): JSX.Element {
  return (
    <button
      className="pinned-header"
      data-testid={testId}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <ChevronIcon expanded={expanded} />
      <span className="pinned-label">{label}</span>
      <span className="pinned-count">{count}</span>
    </button>
  )
}
