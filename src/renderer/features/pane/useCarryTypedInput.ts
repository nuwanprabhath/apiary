import { useEffect, useRef } from 'react'
import type { PtyId } from '@shared/domain/ids'
import type { TabView } from '@shared/domain/tabs'
import { background } from '../../state/policy'
import { carryTerminalInput } from '../../state/carryTypedInput'

/**
 * When the active tab goes from the Terminal view to the Chat view, by whatever path (the toggle,
 * its shortcut, a menu), what was typed in that terminal's Claude input box joins the composer.
 * Watching the view rather than the toggle's click is what covers every path.
 */
export function useCarryTypedInput(sessionId: string | null, view: TabView, ptyId: PtyId | null, running: boolean): void {
  const previous = useRef<{ sessionId: string | null; view: TabView }>({ sessionId, view })
  useEffect(() => {
    const before = previous.current
    previous.current = { sessionId, view }
    if (sessionId === null || ptyId === null || !running) return
    if (before.sessionId !== sessionId || before.view !== 'terminal' || view !== 'transcript') return
    background(carryTerminalInput(sessionId, ptyId), 'chat')
  }, [sessionId, view, ptyId, running])
}
