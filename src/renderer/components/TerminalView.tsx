import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  ptyId: string
  testId: string
  /**
   * Whether this terminal is the one currently on screen. Terminals are hidden rather than
   * unmounted when you switch away from them (that is what preserves their scrollback), so
   * "became visible" is a prop change here, not a mount — see the scroll effect below.
   */
  visible?: boolean
}

/**
 * xterm paints from a JS palette rather than from CSS, so it cannot pick up the stylesheet's
 * design tokens by itself. Reading them off the document at mount keeps the terminal inside the
 * same theming contract as the rest of the UI — see the token block at the top of styles.css —
 * so a future theme recolours the terminal without needing a second palette defined over here.
 */
function themeFromTokens(): ITheme {
  const css = getComputedStyle(document.documentElement)
  // Fall back to the token block's own current values: getPropertyValue returns '' for an
  // unknown property, and handing xterm an empty string paints an invisible terminal.
  const token = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim()
    return value !== '' ? value : fallback
  }
  return {
    background: token('--bg-terminal', '#151618'),
    foreground: token('--text', '#e6e6e6'),
    cursor: token('--text', '#e6e6e6'),
    selectionBackground: token('--selected', '#2f3238'),
  }
}

export function TerminalView({ ptyId, testId, visible = true }: Props): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null)
  // The live xterm instance, exposed to effects outside the mount effect that owns it (the
  // scroll-on-show effect below). Cleared on teardown so a late callback can't touch a disposed
  // terminal.
  const termRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (host.current === null) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: themeFromTokens(),
      convertEol: true,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    fit.fit()
    // A fresh xterm instance always starts with empty scrollback — the PTY itself (and whatever
    // it already printed) is untouched by an unmount, but nothing replays that history into the
    // new instance. When this mount is reattaching to a PTY that was already running (a tab
    // switch back, not a brand-new spawn) at an unchanged size, no real SIGWINCH is delivered
    // and the shell never redraws, so the pane looks blank. Rather than the renderer fabricating
    // a fake size to force a change (a fire-and-forget race with no guarantee the main process
    // won't interleave work between two `ipcRenderer.send` calls), `PtyManager.resize` itself
    // detects a same-size request and forces the redraw by delivering SIGWINCH directly — see
    // the comment on `resize()` in ptyManager.ts. The renderer just reports its real size.
    window.apiary.ptyResize(ptyId, term.cols, term.rows)

    const offData = window.apiary.onPtyData((id, data) => {
      if (id === ptyId) term.write(data)
    })
    const offExit = window.apiary.onPtyExit((id, code) => {
      // Keep the terminal on screen so the exit status is readable.
      if (id === ptyId) term.write(`\r\n[process exited with code ${String(code)}]\r\n`)
    })
    const disposeInput = term.onData((data) => window.apiary.ptyWrite(ptyId, data))

    // Coalesce bursts of ResizeObserver callbacks (e.g. a drag of the bottom-pane resizer fires
    // many in one frame) into a single measurement per animation frame, and only actually fit
    // and tell the PTY about it when the computed cols/rows differ from what was last sent. The
    // guard is not just an optimization: if layout were ever unstable enough to oscillate
    // between two sizes (as it did before centre-pane clipped its overflow — see the comment on
    // .centre-pane in styles.css), calling fit()/ptyResize unconditionally on every callback
    // would keep both fit() and the PTY resize going, repainting the TUI's prompt at alternating
    // row counts. Gating on an actual change makes a no-op resize inert even if the observer
    // still fires.
    let lastCols = term.cols
    let lastRows = term.rows
    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        fit.fit()
        if (term.cols !== lastCols || term.rows !== lastRows) {
          lastCols = term.cols
          lastRows = term.rows
          window.apiary.ptyResize(ptyId, term.cols, term.rows)
        }
      })
    })
    observer.observe(host.current)

    return () => {
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
      offData()
      offExit()
      disposeInput.dispose()
      termRef.current = null
      term.dispose()
      // The PTY deliberately keeps running so the session survives a tab switch.
    }
  }, [ptyId])

  /**
   * Snap to the bottom whenever this terminal becomes the visible one.
   *
   * A backgrounded terminal keeps running and keeps emitting output, but xterm only follows new
   * output while its viewport is already parked at the bottom. A long-running process (a dev
   * server, say) that printed while you were looking at another tab therefore leaves the viewport
   * stranded wherever it was, so switching back shows a frozen mid-scroll view rather than what
   * the process is doing now.
   *
   * Deliberately keyed on `visible` rather than done from the ResizeObserver: a resize also fires
   * when the window changes size, and yanking someone to the bottom because they dragged the
   * window edge — while they were reading further up — would be its own bug. The rAF lets the
   * newly-shown pane lay out (and the observer's fit run) first; scrolling a zero-height viewport
   * silently does nothing.
   */
  useEffect(() => {
    if (!visible) return
    const id = requestAnimationFrame(() => { termRef.current?.scrollToBottom() })
    return () => cancelAnimationFrame(id)
  }, [visible])

  return <div className="terminal-host" data-testid={testId} ref={host} />
}
