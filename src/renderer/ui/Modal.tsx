import { type JSX, type ReactNode, useLayoutEffect, useRef } from 'react'
import { closeOpenHoverCard } from './useHoverCard'
import { useEscape } from './useEscape'

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ')

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((el) => el.getClientRects().length > 0)
}

interface Props {
  testId: string
  /** The element (usually the `<h2>`) that names the dialog for `aria-labelledby`. */
  titleId: string
  onClose: () => void
  /** Relative to the dialog root; defaults to the first focusable element. Destructive confirms pass Cancel. */
  initialFocusSelector?: string
  wide?: boolean
  closeOnBackdropClick?: boolean
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

/** The focus restore a closing dialog has scheduled, until it runs or a dialog opening in its place takes it over. */
let pendingRestore: { element: HTMLElement | null } | null = null

/**
 * The dialog primitive every modal is built from: Escape stack, initial focus, Tab trap, focus restore.
 *
 * Deliberately not built on the native `<dialog>.showModal()`: it puts the dialog in the browser's
 * top layer, *above* the notification stack, which breaks "a failure raised while a dialog is open
 * still has to be readable over it" (styles.css).
 */
export function Modal(
  {
    testId, titleId, onClose, initialFocusSelector, wide = false, closeOnBackdropClick = false,
    className, style, children,
  }: Props,
): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEscape(onClose)

  useLayoutEffect(() => {
    // A hover card left open by the row whose button opened this dialog would draw over it.
    closeOpenHoverCard()
    const root = rootRef.current
    if (root === null) return
    // Whatever had focus on open gets it back on close. A dialog opening in place of one closing
    // in the same commit (the branch picker handing a conflict to its dialog) finds focus on
    // nothing, so it takes over that one's pending restore.
    let previouslyFocused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
      ? document.activeElement
      : null
    if (previouslyFocused === null && pendingRestore !== null) {
      previouslyFocused = pendingRestore.element
      pendingRestore = null
    }
    const target = initialFocusSelector !== undefined
      ? root.querySelector<HTMLElement>(initialFocusSelector)
      : focusablesIn(root)[0]
    target?.focus()
    return () => {
      // Deferred a frame: a dialog can close from an async continuation of the keypress that
      // opened it (BranchSwitcher resolves a checkout on Enter) while that Enter's keyup is still
      // in flight, and a keyup on the restored `<button>` activates it and reopens the dialog.
      const mine = { element: previouslyFocused }
      pendingRestore = mine
      requestAnimationFrame(() => {
        if (pendingRestore !== mine) return
        pendingRestore = null
        mine.element?.focus()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mount; initialFocusSelector is static and re-running would fight the user's Tabbing
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return
    const root = rootRef.current
    if (root === null) return
    const focusables = focusablesIn(root)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={closeOnBackdropClick ? (e) => { if (e.target === e.currentTarget) onClose() } : undefined}
    >
      <div
        ref={rootRef}
        className={['modal', wide ? 'wide' : null, className].filter(Boolean).join(' ')}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={style}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}
