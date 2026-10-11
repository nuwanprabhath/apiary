import type { JSX } from 'react'
import type { GitStatus } from '@shared/types'
import type { PluginBarItemPayload } from '@shared/api'
import { shellPtyId } from '@shared/domain/ptyId'
import type { Column } from '../../state/columns'
import { ShellToolbar } from './ShellToolbar'
import { TerminalView, TerminalListPanel } from '../terminal'
import type { ResizeSeparatorProps } from '../../ui/useResizeDrag'
import type { ShellTerminals } from './useShellTerminals'
import type { GitActions } from './useGitActions'

/** One pane's shell card: the resizer above it, the git/terminal toolbar, every tab's shell
 *  terminals and the terminal list. */
export function ShellPane({
  column, activeKey, keyFor, shell, git, gitStatus, pluginItems, bottomHeight, bottomResizer,
  terminalListWidth, onTerminalListWidth,
}: {
  column: Column
  activeKey: string
  keyFor: (tabKey: string) => string
  shell: ShellTerminals
  git: GitActions
  gitStatus: GitStatus | null
  pluginItems: PluginBarItemPayload[]
  bottomHeight: number
  /** Everything `.bottom-resizer` needs to be a draggable, keyboard-operable separator. */
  bottomResizer: ResizeSeparatorProps
  /** The terminal list's dragged width (null: fit the names), and how to change it. */
  terminalListWidth: number | null
  onTerminalListWidth?: (width: number | null) => void
}): JSX.Element {
  const {
    shellOpen, tabListOpen, setTabListOpen, setRenameRequest, revivals, terminalsFor, activeTerminalFor,
    currentTerminals, currentTerminalId,
  } = shell

  return (
    <>
      {shellOpen && (
        <div className="bottom-resizer" data-testid="bottom-resizer" {...bottomResizer} />
      )}

      {/* UI-6: `var(--drag-bottom-height, …)` reads the live value App's resize drag writes
          straight onto the document root while dragging, falling back to the committed
          `bottomHeight` prop otherwise — the same fallback pattern as the sidebar's width. */}
      <div
        className="bottom-pane shell-card"
        data-testid="shell-card"
        style={{ height: shellOpen ? `var(--drag-bottom-height, ${String(bottomHeight)}px)` : 32 }}
      >
        <ShellToolbar shell={shell} git={git} gitStatus={gitStatus} pluginItems={pluginItems} />
        <div className="terminal-panel-row">
          {/* As with the claude terminals, every open tab's shell terminals stay mounted
           *  so their scrollback survives switching session — a dev server you left running in
           *  one session is still showing its log when you come back to it. */}
          {column.tabs.flatMap((tab) => {
            const key = keyFor(tab.key)
            const shownTerminal = activeTerminalFor(tab.key)
            return terminalsFor(tab.key).map((terminal) => {
              // Note `shellOpen` is part of *visibility*, not of whether this is rendered at
              // all: collapsing the pane used to unmount every terminal in it, so hiding and
              // reshowing the shell threw away the scrollback of anything running in it. A
              // hidden terminal has no box for FitAddon to measure, so it never resizes its
              // pty while collapsed either — the process is left completely undisturbed.
              const visible = shellOpen && tab.key === activeKey && terminal.id === shownTerminal
              return (
                <div
                  key={`${key}:${terminal.id}:${String(revivals.get(shellPtyId(key, terminal.id)) ?? 0)}`}
                  hidden={!visible}
                  className="terminal-tab-view"
                >
                  <TerminalView
                    ptyId={shellPtyId(key, terminal.id)}
                    testId={visible ? 'terminal-shell' : `terminal-shell-${tab.key}-${terminal.id}`}
                    visible={visible}
                    onRenameKey={() => {
                      // The rename field lives in the terminal list, so F2 opens the list too —
                      // renaming something whose name is not on screen would be typing blind.
                      setTabListOpen(true)
                      setRenameRequest({ id: terminal.id })
                    }}
                  />
                </div>
              )
            })
          })}
          {shellOpen && tabListOpen && (
            <TerminalListPanel
              tabs={currentTerminals}
              activeId={currentTerminalId}
              onSwitch={shell.switchTerminalTab}
              onRename={shell.renameTerminalTab}
              onDelete={shell.deleteTerminalTab}
              onReorder={shell.reorderTerminalTab}
              renameRequest={shell.renameRequest}
              onRenameRequestHandled={() => { setRenameRequest(null) }}
              width={terminalListWidth}
              onResize={onTerminalListWidth}
            />
          )}
        </div>
      </div>
    </>
  )
}
