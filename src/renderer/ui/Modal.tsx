import { type JSX, type ReactNode, useLayoutEffect, useRef } from 'react'
import { useEscape } from './useEscape'

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Every element inside `root` that can take keyboard focus right now, in DOM order. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((el) => el.getClientRects().length > 0)
}

interface Props {
  /** `data-testid` on the dialog element itself, matching what existing tests already look for. */
  testId: string
  /** The id of the element (usually the `<h2>`) that names the dialog for `aria-labelledby` —
   *  UI-25's "0 aria-labelledby in the renderer": every `role="dialog"` needs a name. */
  titleId: string
  onClose: () => void
  /** A selector (relative to the dialog root) for what should have focus once it opens. Defaults
   *  to the first focusable element. Destructive confirms pass their Cancel button here — the
   *  finding's own rule ("Destructive confirms should focus Cancel"). */
  initialFocusSelector?: string
  /** `.modal.wide` — a couple of dialogs (Import, the wide BranchSwitcher step) need the room. */
  wide?: boolean
  /**
   * A click on the backdrop itself (not on the dialog) also closes it — the two dialogs that had
   * this before migrating onto `Modal` (NoteDialog, BranchSwitcher) keep it; the rest never had it,
   * and default to false so migrating them onto this primitive is not also a behaviour change.
   */
  closeOnBackdropClick?: boolean
  className?: string
  style?: React.CSSProperties
  children: ReactNode
}

/** The focus restore a closing dialog has scheduled for the next frame, until it runs or a dialog
 *  opening in its place takes it over (see the layout effect below). */
let pendingRestore: { element: HTMLElement | null } | null = null

/**
 * The dialog primitive every modal in the app should be built from (UI-25).
 *
 * Before this, each dialog was a plain `<div role="dialog" aria-modal="true">` with no focus
 * management at all: opening one left focus wherever it already was, Tab walked straight through
 * into the sidebar and terminals behind the backdrop despite `aria-modal`, and closing one never
 * gave focus back to whatever had it before. Four dialogs (`DeleteSessionDialog`, `ConflictDialog`,
 * `MoveSessionDialog`, `WorktreeConflictDialog`) had no Escape handler at all. This fixes all three
 * at once: it registers on the shared Escape stack (UI-13), focuses `initialFocusSelector` (or the
 * first focusable element) on mount, traps Tab within the dialog, and restores focus to whatever
 * was focused before the dialog opened once it unmounts.
 *
 * Deliberately not built on the native `<dialog>.showModal()`, which would give trap/inert/restore
 * for free: it puts the dialog in the browser's top layer, *above* the notification stack, which
 * breaks "a failure raised while a dialog is open still has to be readable over it" (styles.css).
 * Adopting it would mean moving `NotificationCenter` to the top layer too — tracked, not done here.
 */
export function Modal(
  {
    testId, titleId, onClose, initialFocusSelector, wide = false, closeOnBackdropClick = false,
    className, style, children,
  }: Props,
): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEscape(onClose)

  // A layout effect, not a plain one: it focuses `target` in the same synchronous commit as the
  // mount, before the browser paints.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    // Whatever had focus when the dialog opened — usually a button in the row or toolbar it was
    // triggered from — gets it back once the dialog closes, however that happens (Escape, a
    // button, the caller's own logic). Read once, not tracked live: a dialog does not expect the
    // rest of the app to be interactive behind it.
    // A dialog opening in the place of one closing in the same commit (the branch picker handing
    // a worktree conflict to its dialog) finds focus on nothing: it takes over that one's pending
    // restore instead, so its own focus is not stolen a frame later and the control that opened
    // the first still gets focus back once this one closes.
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
      // Deferred a frame, not called synchronously in this cleanup. A dialog can close from an
      // async continuation of the very keypress that opened it — BranchSwitcher's search field
      // resolves an exact-match checkout on Enter and closes once it succeeds, well within the
      // lifetime of that same physical key press. Chromium still has the matching keyup for that
      // Enter in flight, undelivered because nothing had asked for the event loop to turn since the
      // keydown; restoring focus to `previouslyFocused` synchronously here — often a `<button>`,
      // the row or toolbar control that opened the dialog — puts a button under a keyup for Enter
      // that browsers treat as activating it, synthesizing a click that reopens the very dialog
      // that just closed. Measured with two `performance.now()` timestamps: the button's own
      // `onClick` fired 1.4ms after this cleanup restored its focus, with no click ever dispatched
      // by anything in this app's code. One rAF is enough for that queued keyup to be delivered and
      // finish (to whatever had focus at that point, which is nothing useful once this dialog's
      // contents are already unmounted) before focus lands back on a live control.
      const mine = { element: previouslyFocused }
      pendingRestore = mine
      requestAnimationFrame(() => {
        if (pendingRestore !== mine) return
        pendingRestore = null
        mine.element?.focus()
      })
    }
    // Deliberately once per mount: `initialFocusSelector` is a static prop per call site, and
    // re-running this on every render would fight the user's own subsequent Tabbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return
    const root = rootRef.current
    if (root === null) return
    const focusables = focusablesIn(root)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    // Wraps rather than lets Tab leave: without this, Tab from the last button (or Shift+Tab from
    // the first) walked out of the dialog into whatever the backdrop is covering.
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
