import type { JSX } from 'react'

/**
 * The disclosure chevron used by every collapsible row (UI-19/UI-32): a folder, a group, Pinned,
 * Recent. `data-expanded` is what styles.css rotates on — keep that attribute name and the
 * `chevron` class name if this is ever restyled, since CSS selects on both.
 */
export function ChevronIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <svg
      className="chevron"
      data-expanded={expanded}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
