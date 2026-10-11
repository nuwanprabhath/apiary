import type { JSX } from 'react'
import type { NotificationKind } from './notifications'
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

/** A window with its left-hand panel marked — the sidebar show/hide control. */
export function SidebarIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3.5v9" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 6h1M3.5 8h1M3.5 10h1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

/** VS Code's "Collapse Folders": a box with a minus, stacked on the one behind it. */
export function CollapseAllIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 11V3.5a1 1 0 0 1 1-1H11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M7.25 9.5h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Four panes — the layout picker's button. */
export function LayoutIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 2.5v11M2 8h12" stroke="currentColor" strokeWidth="1.2" />
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

/**
 * The refresh glyph: two arrows chasing each other round a circle, the shape VS Code, GitHub and
 * every browser's reload button use. It replaced a single arc with one line-drawn arrowhead,
 * which read as "a circle with an arrow stuck in it" rather than as refresh.
 *
 * The arrowheads are filled triangles rather than two strokes meeting at a point, and each arc
 * stops well short of the other so the pair never closes into a plain ring. Both are because of
 * the size this is actually drawn at — 13px in the sidebar, where a 1.3px chevron is a smudge and
 * a 50° gap is the only thing telling the eye these are arrows and not a circle.
 *
 * It spins in place via the shared `.spinner` class rather than the button swapping its label for
 * a bare glyph, which used to change the button's width mid-click.
 */
export function RefreshIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.47 5.89A5 5 0 0 1 12.53 5.89" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13.14 7.18 10.32 5.63 13.76 4.02Z" fill="currentColor" />
      <path d="M12.53 10.11A5 5 0 0 1 3.47 10.11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.86 8.82 5.68 10.37 2.24 11.98Z" fill="currentColor" />
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

/**
 * A tick, used to acknowledge a copy without changing the button's size — and, with `on` set, the
 * toggle mark beside a checked `ContextMenu` item (UI-32: this duplicated `ContextMenu`'s own
 * inline `<svg>`, byte-for-byte apart from the `data-on` attribute its `.context-menu-check`
 * CSS rule keys off; `on` is that one difference, not a new icon).
 */
export function CheckIcon({ className, on }: IconProps & { on?: boolean }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-on={on}
    >
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * GitLab's merge-request glyph: a branch line merging back into the trunk — one family, three
 * states, because "!1274" beside a branch says nothing about whether that work has landed, and
 * that is the first question anyone asks about a merge request.
 *
 * The state is carried by the *target* node alone, so all three share a silhouette and the eye
 * only has to read one small difference rather than learn three shapes. What that difference is
 * was decided by rendering all three at 14px (the size this is actually drawn at on the bar) and
 * looking, the same way the refresh icon was:
 *
 * - **open** — an outlined ring, the branch arriving at it.
 * - **merged** — the same ring filled solid. A filled 3.6px disc against a 1.2px ring is the
 *   largest difference available in that space, and it is the GitHub/GitLab convention besides.
 * - **closed** — a cross where the ring would be. A ring with something *inside* it turns to mush
 *   at this size; a bare cross keeps two clean strokes.
 */
export function MergeRequestIcon(
  { className, state = 'open' }: IconProps & { state?: 'open' | 'merged' | 'closed' },
): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.8v4.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.8 4h1.4A3 3 0 0 1 10.2 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {state === 'closed'
        ? <path d="M10.6 6.6 13.4 9.4M13.4 6.6 10.6 9.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        : (
          <circle
            cx="12" cy="8" r="1.8"
            stroke="currentColor" strokeWidth="1.2"
            fill={state === 'merged' ? 'currentColor' : 'none'}
          />
        )}
    </svg>
  )
}

/** A generic external link, for plugin buttons that only open something. */
export function LinkIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6.5 9.5l3-3M7 4.5h3.5V8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 9.5v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Something a plugin needs the user to know about before its button can work. */
export function AlertIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 3l5.5 9.5h-11z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 6.8v2.4M8 11h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** A heavier "+" than `PlusIcon`: the sidebar's new-session buttons. */
export function PlusBoldIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A pencil on a sheet's corner: rename the session title in place. */
export function RenameIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-7 7-2.9.6.6-2.9 7-7Z"
        stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The arrow on a menu item that opens a submenu. */
export function SubmenuArrowIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A small speedometer: VS Code's `$(dashboard)`, which the usage extension shows. */
export function GaugeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 11.5l2.6-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A clock turned back: the value shown is the last one known, not a fresh one. */
export function HistoryIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.2 8A4.8 4.8 0 1 0 5 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2.8 2.8v2.6h2.6M8 5.5V8l1.8 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** A box with a slash in it: the slash-command button. */
export function SlashBoxIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <path d="M9.5 5 6.5 11" />
    </svg>
  )
}

const MODE_STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** A raised hand: Claude stops and asks (the Manual permission mode). */
export function HandIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" {...MODE_STROKE}>
      <path d="M5 8V3.5a1 1 0 0 1 2 0V7M7 7V2.5a1 1 0 0 1 2 0V7M9 7V3.5a1 1 0 0 1 2 0V8M11 8V5.5a1 1 0 0 1 2 0v4A4.5 4.5 0 0 1 8.5 14h-.7a4 4 0 0 1-3.2-1.6L2.6 9.8a1 1 0 0 1 1.5-1.3L5 9.5" />
    </svg>
  )
}

/** Code brackets: edits go straight in (the Accept edits permission mode). */
export function CodeBracketsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" {...MODE_STROKE}>
      <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4M9 3 7 13" />
    </svg>
  )
}

/** A scroll: a plan to read first (the Plan permission mode). */
export function ScrollIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" {...MODE_STROKE}>
      <path d="M4 3h8.5a1.5 1.5 0 0 1 0 3H12v6.5A1.5 1.5 0 0 1 10.5 14H3.5A1.5 1.5 0 0 1 2 12.5V12h8M4 3a1.5 1.5 0 0 0-1.5 1.5V12M6 7h4M6 9.5h3" />
    </svg>
  )
}

/** A bolt: Auto, and the starting default. */
export function BoltIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" {...MODE_STROKE}>
      <path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z" />
    </svg>
  )
}

/** How full Claude's context is, as a ring with the percentage inside it. */
export function ContextRingIcon({ pct }: { pct: number }): JSX.Element {
  const r = 9
  const circumference = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle className="chat-context-track" cx="12" cy="12" r={r} />
      <circle
        className="chat-context-fill"
        cx="12" cy="12" r={r}
        strokeDasharray={`${String((pct / 100) * circumference)} ${String(circumference)}`}
        transform="rotate(-90 12 12)"
      />
      <text x="12" y="12" className="chat-context-text">{pct}</text>
    </svg>
  )
}

/**
 * A single glyph per notification kind, so the strip is legible at a glance without reading it —
 * and so a screenshot of a failure says "error" even in greyscale, which colour alone would not.
 */
export function NotificationKindIcon({ kind }: { kind: NotificationKind }): JSX.Element {
  const common = { viewBox: '0 0 16 16', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true } as const
  if (kind === 'error') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.8v4M8 11.1v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'warning') {
    return (
      <svg {...common}>
        <path d="M8 2.2 14.4 13H1.6L8 2.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M8 6.4v3M8 11.2v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'success') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
        <path d="m5.3 8.2 1.9 1.9 3.5-3.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7.2v4M8 4.7v.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronsRightIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.5 4 7.5 8 3.5 12M8.5 4 12.5 8 8.5 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}
