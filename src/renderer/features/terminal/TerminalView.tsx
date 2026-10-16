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
  /** Terminals are hidden, not unmounted, when switched away from (that keeps scrollback), so
   *  "became visible" is a prop change, not a mount. */
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

/** Built on the render the menu opens in, so "Copy" reflects the current selection. */
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
  // Cleared on teardown so a late callback can't touch a disposed terminal.
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
  // Bumped by the stall watchdog to rebuild this view's xterm on the same pty.
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

  // xterm only follows new output while its viewport is parked at the bottom, so a backgrounded
  // terminal that printed is stranded mid-scroll; snap to the bottom when it becomes visible. Keyed
  // on `visible`, not the ResizeObserver: a window resize must not yank a reader to the bottom.
  // The rAF lets the shown pane lay out first; scrolling a zero-height viewport does nothing.
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
 * Every mounted terminal (one per tab, hidden ones included) must not re-render on every
 * SessionColumn render: that rebuilds its context-menu items and calls `getSelection()`.
 *
 * Ignores `onRenameKey`: SessionColumn passes a fresh closure every render, and the callback is
 * read through `onRenameKeyRef`, so a stale reference is harmless. Exported so
 * `terminalViewMemo.test.ts` can test the contract directly.
 */
export function terminalViewPropsEqual(prev: Props, next: Props): boolean {
  return prev.ptyId === next.ptyId && prev.testId === next.testId
    && (prev.visible ?? true) === (next.visible ?? true)
    && (prev.claude ?? false) === (next.claude ?? false)
}

export const TerminalView = memo(TerminalViewImpl, terminalViewPropsEqual)
