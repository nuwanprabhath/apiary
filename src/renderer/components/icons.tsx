interface IconProps { className?: string }

export function BranchIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 4.5V11.5M4 8C6 8 7 7.5 8 6.5C9 5.5 10.5 5.2 12 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function ArrowDownIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 2.5v9M4.5 8 8 11.5 11.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ArrowUpIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 13.5v-9M4.5 8 8 4.5 11.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CopyIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5.5" y="5.5" width="7" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 10.5v-7a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function ListIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Two curved arrows chasing each other into a circle — the refresh button's icon, which spins
 *  in place (via the shared `.spinner` class) rather than the button swapping its whole label
 *  out for a bare glyph, which used to change the button's width mid-click. */
export function RefreshIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M13 8A5 5 0 1 1 11.4 4.3M13 8V4.5M13 8H9.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The horizontal ellipsis VS Code uses for an overflow menu of further commands. */
export function EllipsisIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  )
}

/** A pencil, for the "rename" action on a terminal tab. */
export function PencilIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M10.5 2.5 13.5 5.5 5 14H2V11L10.5 2.5Z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
      />
      <path d="M9 4 12 7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.5 5h9M6.5 5V3.5h3V5M4.5 5l.6 8h5.8l.6-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** VS Code's "split editor" glyph: a pane divided down the middle. */
export function SplitIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 3.5v9" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * A pushpin seen from the side, the same glyph filled or outlined depending on state — an
 * outline reads as "pin this", the filled one as "this is pinned, click to unpin", without
 * needing two different shapes the eye has to learn.
 */
export function PinIcon({ className, filled = false }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M9.6 1.9 14.1 6.4l-1.7.4a2 2 0 0 0-1 .6l-1.9 2.1a2 2 0 0 0-.5 1.6l.2 1.2-4.9-4.9 1.2.2a2 2 0 0 0 1.6-.5l2.1-1.9a2 2 0 0 0 .6-1l.4-1.7Z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
      />
      <path d="M5.6 10.4 2.3 13.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * A note: a page with lines of writing on it. Filled in with a corner fold when the session
 * already has one, so a glance down the sidebar tells you which sessions you have annotated
 * without hovering each in turn.
 */
export function NoteIcon({ className, filled = false }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M4 2.5h5L12 5.5v8H4z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.25 : 0}
      />
      <path d="M9 2.5v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M6 8.5h4M6 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}
