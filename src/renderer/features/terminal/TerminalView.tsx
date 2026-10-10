import type { PtyId } from '@shared/domain/ids'
import { type JSX, memo, useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { THEME_CHANGE_EVENT } from '../../theme/applyTheme'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { pasteText, routeNativePaste } from './terminalPaste'
import { ptyBus } from '../../state/ptyBus'
import { isClaudeSuspended, isSuspendChord } from '@shared/claudeSuspend'
import { SuspendConfirmDialog } from './SuspendConfirmDialog'
import { copyText, readClipboardText } from '../../state/clipboard'
import { attachPty, continuePty, detachPty, readPtySnapshot, resizePty, writePty } from '../../state/terminals'
import { logLine } from '../../state/log'

interface Props {
  ptyId: PtyId
  testId: string
  /**
   * Whether this terminal is the one currently on screen. Terminals are hidden rather than
   * unmounted when you switch away from them (that is what preserves their scrollback), so
   * "became visible" is a prop change here, not a mount — see the scroll effect below.
   */
  visible?: boolean
  /** F2 on this terminal: rename it. Absent where a terminal has no name to change. */
  onRenameKey?: () => void
  /**
   * This terminal runs Claude Code (a session's own terminal, not a shell). Ctrl+Z then asks
   * before suspending, and a suspended Claude gets a Resume bar — see SuspendConfirmDialog and
   * `PtyManager.resume` for why this terminal cannot use `fg`.
   */
  claude?: boolean
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

/**
 * How long a view may spend catching up (snapshot fetched, painted, live output drained behind it)
 * before it gives up waiting and shows live output anyway. Catching up normally takes a few
 * milliseconds; one that never finished left a terminal that took keystrokes but never drew them,
 * stuck at the snapshot's width — reported from Ubuntu, cured only by closing the tab.
 */
const CATCH_UP_TIMEOUT_MS = 4000
/**
 * How long after output arrives xterm may take to parse it and draw, before the view counts as
 * stuck and is rebuilt (what closing and reopening the tab did by hand). Generous: a busy terminal
 * parses in time slices, and drawing waits for the next frame.
 */
const STALL_MS = 4000
/** A view rebuilt this many times in a minute stops trying, rather than rebuilding forever. */
const MAX_REBUILDS_PER_MINUTE = 3

/** On screen and in front: the only state in which "nothing was drawn" means something is wrong.
 *  A hidden tab, a background window and a minimised one all legitimately draw nothing. */
function inView(el: HTMLElement | null): boolean {
  if (el === null || document.visibilityState !== 'visible' || !document.hasFocus()) return false
  if (!el.checkVisibility()) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

function TerminalViewImpl({ ptyId, testId, visible = true, onRenameKey, claude = false }: Props): JSX.Element {
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
  // Read by the key and input handlers, which are installed once per pty.
  const claudeRef = useRef(claude)
  claudeRef.current = claude
  const [confirmingSuspend, setConfirmingSuspend] = useState(false)
  const [suspended, setSuspended] = useState(false)
  const suspendedRef = useRef(false)
  // Bumped to tear this view's xterm down and build a fresh one on the same pty — the mount effect
  // depends on it. Only the stall watchdog below does this.
  const [generation, setGeneration] = useState(0)
  const rebuildsRef = useRef<number[]>([])

  const resume = (): void => {
    suspendedRef.current = false
    setSuspended(false)
    continuePty(ptyId)
    termRef.current?.focus()
  }
  // Called from handlers installed once per pty; always the current closure.
  const resumeRef = useRef(resume)
  resumeRef.current = resume

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
    // Which step catching up is on, for the log line if it never finishes.
    let stage: 'snapshot' | 'paint' | 'drain' = 'snapshot'
    const queued: string[] = []
    let lastCols = term.cols
    let lastRows = term.rows

    /**
     * Runs app code from inside an xterm write callback without letting it throw there. xterm calls
     * those callbacks in the middle of its parse loop with no guard: an exception ends the loop
     * before it schedules the next batch, and every later write joins a queue nothing drains — a
     * terminal that still sends what you type but never draws again.
     */
    const guarded = (what: string, fn: () => void): void => {
      try {
        fn()
      } catch (err) {
        logLine('error', 'pty', `terminal ${what} failed`, { ptyId, error: String(err) })
      }
    }

    /**
     * The stall watchdog. After output arrives (at most once per `STALL_MS`), checks that xterm
     * both parsed it and drew afterwards; if either never happens while the terminal is on screen
     * and in front, the view is rebuilt — a fresh xterm caught up from a fresh snapshot.
     */
    let lastRenderAt = 0
    const disposeRender = term.onRender(() => { lastRenderAt = performance.now() })
    let watch: number | null = null
    // When output last arrived, so a check that ends healthy knows whether output that came in
    // after its probe still needs checking.
    let lastDataAt = 0
    const rebuild = (why: Record<string, unknown>): void => {
      const now = Date.now()
      rebuildsRef.current = rebuildsRef.current.filter((t) => now - t < 60_000)
      if (rebuildsRef.current.length >= MAX_REBUILDS_PER_MINUTE) {
        logLine('error', 'pty', 'terminal keeps getting stuck; not rebuilding again', { ptyId, ...why })
        return
      }
      rebuildsRef.current.push(now)
      logLine('warn', 'pty', 'terminal stopped drawing; rebuilt it', { ptyId, ...why })
      setGeneration((g) => g + 1)
    }
    const watchForStall = (): void => {
      if (watch !== null || disposed) return
      let parsed = false
      const probedAt = performance.now()
      term.write('', () => { parsed = true })
      // Output that arrived after the probe was written is not covered by it: check again.
      const again = (): void => { if (lastDataAt > probedAt) watchForStall() }
      watch = window.setTimeout(() => {
        watch = null
        if (disposed) return
        if (!inView(host.current)) { again(); return }
        if (!parsed) { rebuild({ parsed }); return }
        // Parsed: now ask for a full redraw and see whether one happens. A renderer that has
        // paused itself (xterm pauses while it believes it is off screen) never draws again.
        const askedAt = performance.now()
        term.refresh(0, term.rows - 1)
        watch = window.setTimeout(() => {
          watch = null
          if (disposed) return
          if (inView(host.current) && lastRenderAt < askedAt) { rebuild({ parsed, rendered: false }); return }
          again()
        }, 1000)
      }, STALL_MS)
    }

    // Declared before the snapshot is requested: main sends `ptyData` only to attached windows,
    // and IPC from one renderer is ordered, so nothing falls between attach and snapshot.
    attachPty(ptyId)
    const offData = ptyBus.onData(ptyId, (data) => {
      lastDataAt = performance.now()
      if (caughtUp) { term.write(data); watchForStall() }
      else queued.push(data)
    })

    /** Writes whatever has queued up, and calls `done` once xterm has parsed all of it. Loops
     *  because output can keep arriving while a batch is being parsed. */
    const drain = (done: () => void): void => {
      if (disposed) return
      if (queued.length === 0) { done(); return }
      const batch = queued.splice(0).join('')
      term.write(batch, () => { guarded('catch-up', () => { drain(done) }) })
    }

    /** Fits to the pane and tells the pty. On an unchanged size `PtyManager.resize` itself forces
     *  the redraw a reattaching view needs — see the comment on `resize()` in ptyManager.ts. */
    const settle = (): void => {
      fit.fit()
      lastCols = term.cols
      lastRows = term.rows
      resizePty(ptyId, term.cols, term.rows)
    }
    const finishCatchUp = (): void => {
      if (caughtUp) return
      caughtUp = true
      settle()
    }

    // Caught up or not, live output is shown after this long: a view that waits forever for a
    // round trip that is never coming is the stuck terminal. Logged, so the next one says where.
    const catchUpTimer = window.setTimeout(() => {
      if (disposed || caughtUp) return
      logLine('warn', 'pty', 'terminal catch-up stalled; showing live output', { ptyId, stage, queued: queued.length })
      const late = queued.splice(0).join('')
      guarded('catch-up', finishCatchUp)
      if (late !== '') term.write(late)
      watchForStall()
    }, CATCH_UP_TIMEOUT_MS)

    void readPtySnapshot(ptyId)
      .then((snap) => new Promise<void>((resolve) => {
        // Given up on (above): live output is already on screen, and painting the old screen over
        // it now would put the past below the present.
        if (disposed || caughtUp || snap === null) { resolve(); return }
        stage = 'paint'
        term.resize(snap.cols, snap.rows)
        term.write(snap.data, resolve)
      }))
      .finally(() => {
        stage = 'drain'
        drain(finishCatchUp)
      })
    const offExit = ptyBus.onExit(ptyId, (code) => {
      // Keep the terminal on screen so the exit status is readable.
      term.write(`\r\n[process exited with code ${String(code)}]\r\n`)
    })
    const disposeInput = term.onData((data) => {
      // A suspended Claude reads nothing until it is continued, and whatever reaches the pty
      // meanwhile is typed into its prompt afterwards — `fg`, most likely, since that is what it
      // tells you to type. Ctrl+C would kill it outright. So nothing is passed on; Enter resumes.
      if (claudeRef.current && suspendedRef.current) {
        if (data === '\r') resumeRef.current()
        return
      }
      writePty(ptyId, data)
    })

    // Watch for Claude Code's own "has been suspended" screen, whoever caused it — the Suspend
    // button below, or a Ctrl+Z that reached it some other way. Checked once per frame at most.
    let suspendCheck: number | null = null
    const disposeParsed = term.onWriteParsed(() => {
      if (!claudeRef.current || suspendCheck !== null) return
      suspendCheck = requestAnimationFrame(() => {
        suspendCheck = null
        if (disposed) return
        const buffer = term.buffer.active
        const lines: string[] = []
        for (let i = 0; i < term.rows; i++) {
          lines.push(buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '')
        }
        const now = isClaudeSuspended(lines)
        if (now !== suspendedRef.current) {
          suspendedRef.current = now
          setSuspended(now)
        }
      })
    })

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
      // Ctrl+Z is "undo" everywhere else people type, and Claude Code takes it as "suspend".
      // Asked first, with "don't" as the default; see SuspendConfirmDialog.
      if (claudeRef.current && !suspendedRef.current && isSuspendChord(e)) {
        e.preventDefault()
        setConfirmingSuspend(true)
        return false
      }
      if (!e.ctrlKey && !e.metaKey) return true
      const key = e.key.toLowerCase()

      if (key === 'c' && (e.shiftKey || term.hasSelection())) {
        const selection = term.getSelection()
        if (selection !== '') {
          void copyText(selection)
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
        void readClipboardText().then((text) => { if (text !== null) pasteText(term, text) })
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
          resizePty(ptyId, term.cols, term.rows)
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
        resizePty(ptyId, term.cols, term.rows)
      }
    }
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)

    return () => {
      disposed = true
      window.clearTimeout(catchUpTimer)
      if (watch !== null) window.clearTimeout(watch)
      disposeRender.dispose()
      disposeNativePaste()
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
      offData()
      offExit()
      detachPty(ptyId)
      disposeInput.dispose()
      disposeParsed.dispose()
      if (suspendCheck !== null) cancelAnimationFrame(suspendCheck)
      termRef.current = null
      term.dispose()
      // The PTY deliberately keeps running so the session survives a tab switch.
    }
  }, [ptyId, generation])

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
          void copyText(selection)
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
        void readClipboardText().then((text) => { if (text !== null) pasteText(current, text) })
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
        data-own-context-menu
        ref={host}
        onContextMenu={handleContextMenu}
      />
      {suspended && (
        <div className="terminal-suspended-bar" data-testid="terminal-suspended" role="status">
          <span>Claude Code is suspended. Your draft is kept.</span>
          <button className="btn small primary" data-testid="terminal-resume" onClick={resume}>
            Resume
          </button>
          <span className="terminal-suspended-hint">or press Enter</span>
        </div>
      )}
      {confirmingSuspend && (
        <SuspendConfirmDialog
          onKeepRunning={() => { setConfirmingSuspend(false) }}
          onSuspend={() => {
            setConfirmingSuspend(false)
            writePty(ptyId, '\x1a')
            termRef.current?.focus()
          }}
        />
      )}
      <ContextMenu
        testId="terminal-menu"
        items={contextMenuItems}
        position={contextMenuPosition}
        onClose={() => setContextMenuPosition(null)}
      />
    </>
  )
}

/**
 * UI-4 step 5: every mounted terminal (there is one per tab, hidden ones included — see
 * SessionColumn) used to re-render on every App/SessionColumn render, rebuilding its context-menu
 * items and calling `getSelection()` for a component that is 99% of the time not even visible.
 *
 * Deliberately ignores `onRenameKey`: SessionColumn passes a fresh closure for it on every render
 * (it captures nothing that varies — see its call site), and the callback is read through
 * `onRenameKeyRef` above rather than captured at mount, so a stale reference between two renders
 * that this lets through is harmless — same as it always was for the mount effect itself, which
 * never re-subscribed on identity change to begin with. Exported so `terminalViewMemo.test.ts`
 * can test the contract directly rather than trying to detect a `memo` bailout from outside.
 */
export function terminalViewPropsEqual(prev: Props, next: Props): boolean {
  return prev.ptyId === next.ptyId && prev.testId === next.testId
    && (prev.visible ?? true) === (next.visible ?? true)
    && (prev.claude ?? false) === (next.claude ?? false)
}

export const TerminalView = memo(TerminalViewImpl, terminalViewPropsEqual)
