import { createElement, type HTMLAttributes, type JSX, type Ref, useLayoutEffect, useState } from 'react'

type PopoverProps = Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'aria-label'> & {
  /** Names the dialog for a screen reader (there is no visible title to point `aria-labelledby` at). */
  label: string
  /** Give focus back to what had it when the popover opened, once it closes and nothing else has
   *  taken it. Default true; off for a popover that manages focus itself. */
  restoreFocus?: boolean
  ref?: Ref<HTMLDivElement>
  testId?: string
}

/**
 * A non-modal `role="dialog"` that floats beside its opener (a command search, a layout picker, a
 * pet's chat) — as opposed to `Modal`, which traps Tab and covers the window. It is named, and
 * closing it returns focus to the control that opened it rather than dropping it on `body`, where
 * the next Tab would start from the top of the page.
 *
 * Escape and outside clicks stay with the caller (`useEscape`, `useOutsideDismiss`): which layer
 * closes first is a decision of the popover's owner.
 */
export function Popover({ label, restoreFocus = true, ref, testId, ...rest }: PopoverProps): JSX.Element {
  useRestoreFocus(restoreFocus)
  return createElement('div', { role: 'dialog', 'aria-label': label, 'data-testid': testId, ref, ...rest })
}

/**
 * Remembers what had focus before this mounted, and on unmount puts it back if focus has been lost
 * to the page. Read during the first render, not in an effect: a child with `autoFocus` has moved
 * focus by the time this component's own effects run.
 */
function useRestoreFocus(enabled: boolean): void {
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  useLayoutEffect(() => {
    if (!enabled) return
    return () => {
      // After the unmount has settled: a closing popover whose action focused something else (the
      // message box, once a command was inserted into it) keeps that focus.
      requestAnimationFrame(() => {
        const active = document.activeElement
        if ((active === null || active === document.body) && opener?.isConnected === true) opener.focus()
      })
    }
  }, [enabled, opener])
}
