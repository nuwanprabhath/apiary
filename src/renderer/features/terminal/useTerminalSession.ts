import type { PtyId } from '@shared/domain/ids'
import { type RefObject, useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { THEME_CHANGE_EVENT } from '../../theme/applyTheme'
import { ptyBus } from '../../state/ptyBus'
import { attachPty, detachPty, writePty } from '../../state/terminals'
import { routeNativePaste } from './terminalPaste'
import { createCatchUp } from './terminalCatchUp'
import { createTerminalKeyHandler, watchForSuspension, type TerminalKeyContext } from './terminalKeys'
import { fontFromTokens, themeFromTokens } from './terminalTheme'
import { createStallWatchdog, requestRebuild } from './terminalWatchdog'

interface Session {
  ptyId: PtyId
  /** Bumped to tear this view's xterm down and build a fresh one on the same pty. */
  generation: number
  host: RefObject<HTMLDivElement | null>
  /** Cleared on teardown so a late callback can't touch a disposed terminal. */
  termRef: RefObject<Terminal | null>
  /** Times of recent rebuilds; outlives each xterm. */
  rebuildsRef: RefObject<number[]>
  /** Rebuild the view (the stall watchdog's remedy). */
  rebuild: () => void
  /** Read by the key and input handlers, which are installed once per pty. */
  keys: TerminalKeyContext
  /** Enter on a suspended Claude resumes it. */
  resume: () => void
  setSuspended: (suspended: boolean) => void
}

export function useTerminalSession(s: Session): void {
  const { ptyId, generation, host, termRef, rebuildsRef, rebuild, keys, resume, setSuspended } = s
  useEffect(() => {
    if (host.current === null) return

    const term = new Terminal({
      fontFamily: fontFromTokens(),
      fontSize: 12,
      cursorBlink: true,
      theme: themeFromTokens(),
      // A glass theme's terminal background is see-through; xterm needs telling before open().
      allowTransparency: true,
      convertEol: true,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    const disposeNativePaste = routeNativePaste(host.current, term)

    const watchdog = createStallWatchdog(
      term,
      () => host.current,
      (why) => { requestRebuild(rebuildsRef.current, ptyId, why, rebuild) },
    )
    const catchUp = createCatchUp(term, fit, ptyId, watchdog.check)

    // Declared before the snapshot is requested: main sends `ptyData` only to attached windows,
    // and IPC from one renderer is ordered, so nothing falls between attach and snapshot.
    attachPty(ptyId)
    const offData = ptyBus.onData(ptyId, (data) => {
      watchdog.noteData()
      if (catchUp.receive(data)) watchdog.check()
    })
    catchUp.begin()
    const offExit = ptyBus.onExit(ptyId, (code) => {
      // Keep the terminal on screen so the exit status is readable.
      term.write(`\r\n[process exited with code ${String(code)}]\r\n`)
    })
    const disposeInput = term.onData((data) => {
      // Input reaching a suspended Claude is typed into its prompt afterwards (Ctrl+C would kill
      // it), so nothing is passed on; Enter resumes.
      if (keys.claude() && keys.suspended()) {
        if (data === '\r') resume()
        return
      }
      writePty(ptyId, data)
    })
    const stopWatchingSuspension = watchForSuspension(term, keys.claude, keys.suspended, setSuspended)
    // Via xterm's hook, not a DOM listener, so a key can be swallowed before it reaches the pty.
    term.attachCustomKeyEventHandler(createTerminalKeyHandler(term, keys))

    // One measurement per animation frame (a resizer drag fires many callbacks per frame), and the
    // pty is told only when cols/rows changed: if layout ever oscillated between two sizes,
    // resizing unconditionally would repaint the TUI at alternating row counts. Until the snapshot
    // is painted the view is at the snapshot's size, and `refit` does nothing.
    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        catchUp.refit()
      })
    })
    observer.observe(host.current)

    // A different font changes the cell size, so the view is refitted.
    const onTheme = (): void => {
      term.options.theme = themeFromTokens()
      term.options.fontFamily = fontFromTokens()
      catchUp.refit()
    }
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)

    return () => {
      catchUp.dispose()
      watchdog.dispose()
      disposeNativePaste()
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
      offData()
      offExit()
      detachPty(ptyId)
      disposeInput.dispose()
      stopWatchingSuspension()
      termRef.current = null
      term.dispose()
      // The PTY deliberately keeps running so the session survives a tab switch.
    }
    // Everything but the pty and generation is a ref, a state setter or a callback stable for the
    // component's life, so only those two build a new xterm.
  }, [ptyId, generation, host, termRef, rebuildsRef, rebuild, keys, resume, setSuspended])
}
