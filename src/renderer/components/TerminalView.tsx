import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  ptyId: string
  testId: string
}

export function TerminalView({ ptyId, testId }: Props): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (host.current === null) return

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#151618', foreground: '#e6e6e6' },
      convertEol: true,
    })
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
      term.dispose()
      // The PTY deliberately keeps running so the session survives a tab switch.
    }
  }, [ptyId])

  return <div className="terminal-host" data-testid={testId} ref={host} />
}
