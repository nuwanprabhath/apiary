import type { PtyId } from '@shared/domain/ids'
import { type JSX, type RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { pasteText } from './terminalPaste'
import { SuspendConfirmDialog } from './SuspendConfirmDialog'
import { copyText, readClipboardText } from '../../state/clipboard'
import { continuePty, writePty } from '../../state/terminals'
import { useTerminalSession } from './useTerminalSession'

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

/** The right-click menu's items. Built on the render the menu opens in, so "Copy" reflects the
 *  selection as it is at that moment rather than whatever it was at the last unrelated render. */
function terminalMenuItems(termRef: RefObject<Terminal | null>): ContextMenuItem[] {
  const hasSelection = (termRef.current?.getSelection() ?? '') !== ''
  return [
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
  // Bumped to tear this view's xterm down and build a fresh one on the same pty — the session
  // effect depends on it. Only the stall watchdog does this.
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
  const resumeCurrent = useCallback(() => { resumeRef.current() }, [])
  const rebuild = useCallback(() => { setGeneration((g) => g + 1) }, [])
  const setSuspendedBoth = useCallback((now: boolean) => {
    suspendedRef.current = now
    setSuspended(now)
  }, [])
  const keys = useMemo(() => ({
    renameKey: () => onRenameKeyRef.current,
    claude: () => claudeRef.current,
    suspended: () => suspendedRef.current,
    askSuspend: () => { setConfirmingSuspend(true) },
  }), [])

  useTerminalSession({
    ptyId, generation, host, termRef, rebuildsRef, rebuild, keys, resume: resumeCurrent, setSuspended: setSuspendedBoth,
  })

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
        items={terminalMenuItems(termRef)}
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
