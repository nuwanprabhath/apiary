import { useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { THEME_CHANGE_EVENT } from '../theme/applyTheme'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { pasteText } from '../state/terminalPaste'

interface Props {
  ptyId: string
  testId: string
  /**
   * Whether this terminal is the one currently on screen. Terminals are hidden rather than
   * unmounted when you switch away from them (that is what preserves their scrollback), so
   * "became visible" is a prop change here, not a mount — see the scroll effect below.
   */
  visible?: boolean
  /** F2 on this terminal: rename it. Absent where a terminal has no name to change. */
  onRenameKey?: () => void
}

/**
 * xterm paints from a JS palette rather than from CSS, so it cannot pick up the stylesheet's
 * design tokens by itself. Reading them off the document at mount keeps the terminal inside the
 * same theming contract as the rest of the UI — see the token block at the top of styles.css —
 * so a future theme recolours the terminal without needing a second palette defined over here.
 */
function themeFromTokens(): ITheme {
  const css = getComputedStyle(document.documentElement)
  // Fall back to the original look's values: getPropertyValue returns '' for an unknown
  // property, and handing xterm an empty string paints an invisible terminal.
  const token = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim()
    return value !== '' ? value : fallback
  }
  return {
    background: token('--term-background', '#151618'),
    foreground: token('--term-foreground', '#e6e6e6'),
    cursor: token('--term-cursor', '#e6e6e6'),
    selectionBackground: token('--term-selection', '#2f3238'),
    black: token('--term-black', '#1b1c1e'),
    red: token('--term-red', '#e0736d'),
    green: token('--term-green', '#58c06e'),
    yellow: token('--term-yellow', '#e3b341'),
    blue: token('--term-blue', '#6cb6ff'),
    magenta: token('--term-magenta', '#b385f5'),
    cyan: token('--term-cyan', '#56c8d8'),
    white: token('--term-white', '#d0d0d0'),
    brightBlack: token('--term-bright-black', '#6b7075'),
    brightRed: token('--term-bright-red', '#ff8f88'),
    brightGreen: token('--term-bright-green', '#7ee08f'),
    brightYellow: token('--term-bright-yellow', '#f5cd6a'),
    brightBlue: token('--term-bright-blue', '#94cbff'),
    brightMagenta: token('--term-bright-magenta', '#cda6ff'),
    brightCyan: token('--term-bright-cyan', '#86e1ec'),
    brightWhite: token('--term-bright-white', '#ffffff'),
  }
}

/** The terminal's font stack — the theme's monospace choice, via the same token the page uses. */
function fontFromTokens(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return value !== '' ? value : 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
}

export function TerminalView({ ptyId, testId, visible = true, onRenameKey }: Props): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null)
  // Read through a ref by the key handler, which is installed once per pty: a callback captured
  // at mount would rename whichever terminal list was current when the terminal was created.
  const onRenameKeyRef = useRef(onRenameKey)
  onRenameKeyRef.current = onRenameKey
  // The live xterm instance, exposed to effects outside the mount effect that owns it (the
  // scroll-on-show effect below). Cleared on teardown so a late callback can't touch a disposed
  // terminal.
  const termRef = useRef<Terminal | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(
    null,
  )

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

    /**
     * Catch this fresh xterm up on the pty it is attaching to, *then* size it to the pane.
     *
     * A view attaching to a running pty — a tab switched back to, a session opened in a second
     * window, a tab moved between panes — starts with nothing, and a TUI sitting at a prompt may
     * never print again. It used to be caught up by replaying the pty's raw output, but that
     * output was produced at whatever widths the session had over its life, by a program that
     * places each word at an absolute column. Replayed into a narrower pane the words landed in
     * the wrong columns and overwrote one another — the scrambled conversation above an intact
     * prompt that was reported.
     *
     * So the main process hands over a rendered snapshot instead (`ScreenBuffers.snapshot`), and
     * the order here is the fix as much as the snapshot is:
     *
     * 1. Paint it at the size it was laid out for.
     * 2. Only once xterm has *parsed* it, fit to the pane and resize the pty — which makes the
     *    program repaint itself at the new width. `write()` parses asynchronously while
     *    `resize()` applies at once, so resizing straight after writing would lay the snapshot
     *    out at the new width after all, which is the bug again by another route.
     *
     * Live output arriving meanwhile is queued, not written, and drained in order behind the
     * snapshot: writing it first would put the present above the past. `disposed` guards a tab
     * closed before the round trip lands, since writing to a disposed terminal throws.
     */
    let disposed = false
    let caughtUp = false
    const queued: string[] = []
    let lastCols = term.cols
    let lastRows = term.rows

    const offData = window.apiary.onPtyData((id, data) => {
      if (id !== ptyId) return
      if (caughtUp) term.write(data)
      else queued.push(data)
    })

    /** Writes whatever has queued up, and calls `done` once xterm has parsed all of it. Loops
     *  because output can keep arriving while a batch is being parsed. */
    const drain = (done: () => void): void => {
      if (disposed) return
      if (queued.length === 0) { done(); return }
      const batch = queued.splice(0).join('')
      term.write(batch, () => { drain(done) })
    }

    /** Fits to the pane and tells the pty. On an unchanged size `PtyManager.resize` itself forces
     *  the redraw a reattaching view needs — see the comment on `resize()` in ptyManager.ts. */
    const settle = (): void => {
      fit.fit()
      lastCols = term.cols
      lastRows = term.rows
      window.apiary.ptyResize(ptyId, term.cols, term.rows)
    }

    void window.apiary.ptySnapshot(ptyId)
      .then((snap) => new Promise<void>((resolve) => {
        if (disposed || snap === null) { resolve(); return }
        term.resize(snap.cols, snap.rows)
        term.write(snap.data, resolve)
      }))
      // A snapshot that cannot be fetched is a terminal that starts empty, which is where a
      // brand-new pty starts anyway — not worth an error in front of a running session.
      .catch(() => { /* as above */ })
      .finally(() => {
        drain(() => {
          caughtUp = true
          settle()
        })
      })
    const offExit = window.apiary.onPtyExit((id, code) => {
      // Keep the terminal on screen so the exit status is readable.
      if (id === ptyId) term.write(`\r\n[process exited with code ${String(code)}]\r\n`)
    })
    const disposeInput = term.onData((data) => window.apiary.ptyWrite(ptyId, data))

    /**
     * Copy/paste, via xterm's own hook rather than a DOM listener.
     *
     * This has to run *before* xterm processes the key and be able to swallow it: a listener on the
     * host element fires after xterm has already written to the pty, so calling preventDefault
     * there would copy the selection and still send SIGINT. Returning false here is what stops the
     * key reaching the terminal at all.
     *
     * Ctrl+C only copies when something is selected — with no selection it must still interrupt
     * whatever is running, which is the single most important key in a terminal. Ctrl+Shift+C
     * always copies (the Linux convention), and paste is Ctrl+Shift+V, or Cmd+V on macOS, since a
     * bare Ctrl+V is a control character a terminal is entitled to receive.
     */
    const isMac = navigator.userAgent.includes('Mac')
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      // F2 is the rename key almost everywhere a list of named things exists, and no shell or
      // common terminal program here depends on it — so it is taken before the pty sees it.
      if (
        e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
        && onRenameKeyRef.current !== undefined
      ) {
        onRenameKeyRef.current()
        return false
      }
      if (!e.ctrlKey && !e.metaKey) return true
      const key = e.key.toLowerCase()

      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        const selection = term.getSelection()
        if (selection !== '') {
          void window.apiary.copyToClipboard(selection).catch(() => {
            // Nothing useful to say if the clipboard refuses; the selection is still on screen.
          })
          term.clearSelection()
        }
        return false
      }

      if (key === 'v' && (e.shiftKey || (isMac && e.metaKey))) {
        // Returning false below stops xterm's own *keydown*-driven handling, but it does not
        // stop the browser's default action for this chord — on Linux, Chromium treats
        // Ctrl+Shift+V as a native paste shortcut in its own right and, left unprevented, fires
        // a 'paste' DOM event on the textarea as a result of this same keypress. xterm listens
        // for that event independently (see terminalPaste.ts) and would call its own paste()
        // a second time from it. preventDefault() here is what stops that second, browser-issued
        // paste from ever starting — measured against a real Ubuntu 24.04 run, which is the only
        // way this doubling reproduces (a macOS run does not hit it: Ctrl+Shift+V has no native
        // paste action there, only Cmd+V does).
        e.preventDefault()
        // Read the clipboard ourselves only to hand the text to xterm's own `paste()` — not to
        // write it to the pty directly. `paste()` is the same call the browser's native paste
        // event would otherwise drive, so there is exactly one write path instead of two.
        void navigator.clipboard.readText()
          .then((text) => { pasteText(term, text) })
          .catch(() => {
            // Clipboard read can be refused; better to do nothing than to interrupt the session.
          })
        return false
      }

      return true
    })

    // Coalesce bursts of ResizeObserver callbacks (e.g. a drag of the bottom-pane resizer fires
    // many in one frame) into a single measurement per animation frame, and only actually fit
    // and tell the PTY about it when the computed cols/rows differ from what was last sent. The
    // guard is not just an optimization: if layout were ever unstable enough to oscillate
    // between two sizes (as it did before centre-pane clipped its overflow — see the comment on
    // .centre-pane in styles.css), calling fit()/ptyResize unconditionally on every callback
    // would keep both fit() and the PTY resize going, repainting the TUI's prompt at alternating
    // row counts. Gating on an actual change makes a no-op resize inert even if the observer
    // still fires.
    let rafId: number | null = null
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        // Until the snapshot is painted the view is deliberately at the snapshot's size, not the
        // pane's; fitting now would resize it under a snapshot still being parsed.
        if (!caughtUp) return
        fit.fit()
        if (term.cols !== lastCols || term.rows !== lastRows) {
          lastCols = term.cols
          lastRows = term.rows
          window.apiary.ptyResize(ptyId, term.cols, term.rows)
        }
      })
    })
    observer.observe(host.current)

    // A theme change repaints the terminal in place — new palette, new font — rather than only
    // taking effect for terminals opened afterwards. A different font changes the cell size, so
    // the view is refitted and the pty told if that changed its rows or columns.
    const onTheme = (): void => {
      term.options.theme = themeFromTokens()
      term.options.fontFamily = fontFromTokens()
      if (!caughtUp) return
      fit.fit()
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols
        lastRows = term.rows
        window.apiary.ptyResize(ptyId, term.cols, term.rows)
      }
    }
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)

    return () => {
      disposed = true
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
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

  // Read when the menu opens (that is the render this state change causes), so "Copy" reflects the
  // selection as it is at that moment rather than whatever it was at the last unrelated render.
  const hasSelection = (termRef.current?.getSelection() ?? '') !== ''
  const contextMenuItems: ContextMenuItem[] = [
    {
      id: 'copy',
      label: 'Copy',
      disabled: !hasSelection,
      run: () => {
        const selection = termRef.current?.getSelection()
        if (selection) {
          window.apiary.copyToClipboard(selection)
          termRef.current?.clearSelection()
        }
      },
    },
    {
      id: 'paste',
      label: 'Paste',
      run: () => {
        const current = termRef.current
        if (current === null) return
        navigator.clipboard.readText().then((text) => {
          pasteText(current, text)
        }).catch((err) => {
          console.error('Failed to read clipboard:', err)
        })
      },
    },
    {
      id: 'select-all',
      label: 'Select all',
      run: () => {
        termRef.current?.selectAll()
      },
    },
    {
      id: 'clear',
      label: 'Clear',
      run: () => {
        termRef.current?.clear()
      },
    },
  ]

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  return (
    <>
      <div
        className="terminal-host"
        data-testid={testId}
        ref={host}
        onContextMenu={handleContextMenu}
      />
      <ContextMenu
        testId="terminal-menu"
        items={contextMenuItems}
        position={contextMenuPosition}
        onClose={() => setContextMenuPosition(null)}
      />
    </>
  )
}
