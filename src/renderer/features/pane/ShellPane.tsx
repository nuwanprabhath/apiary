import { type JSX, useRef } from 'react'
import type { GitStatus } from '@shared/types'
import type { PluginBarItemPayload } from '@shared/api'
import { shellPtyId } from '@shared/domain/ptyId'
import type { Column } from '../layout/columns'
import { Toolbar, type ToolbarButtonSpec } from './Toolbar'
import { pluginButtons } from './pluginBar'
import { TerminalView } from '../terminal/TerminalView'
import { TerminalListPanel } from '../terminal/TerminalListPanel'
import { GitMenu } from '../git/GitMenu'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { BranchIcon, ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, ListIcon, EllipsisIcon } from '../../ui/icons'
import type { ShellTerminals } from './useShellTerminals'
import type { GitActions } from './useGitActions'

/** Where the shell card may be dragged to — the clamp lives in App (`onBottomHeightStep` and the
 *  drag), this only describes it for a screen reader. */
const MIN_BOTTOM_HEIGHT = 120
const MAX_BOTTOM_HEIGHT = 560

/** One pane's shell card: the resizer above it, the git/terminal toolbar, every tab's shell
 *  terminals and the terminal list. */
export function ShellPane({
  column, activeKey, keyFor, shell, git, gitStatus, pluginItems, bottomHeight, onStartBottomResize,
  onBottomHeightStep, terminalListWidth, onTerminalListWidth,
}: {
  column: Column
  activeKey: string
  keyFor: (tabKey: string) => string
  shell: ShellTerminals
  git: GitActions
  gitStatus: GitStatus | null
  pluginItems: PluginBarItemPayload[]
  bottomHeight: number
  onStartBottomResize: () => void
  /** The keyboard alternative to dragging `.bottom-resizer` (UI-27): steps `bottomHeight` by the
   *  given number of pixels (negative shrinks). */
  onBottomHeightStep: (delta: number) => void
  /** The terminal list's dragged width (null: fit the names), and how to change it. */
  terminalListWidth: number | null
  onTerminalListWidth?: (width: number | null) => void
}): JSX.Element {
  const {
    shellOpen, tabListOpen, setTabListOpen, setRenameRequest, revivals, terminalsFor, activeTerminalFor,
    currentTerminals, currentTerminalId,
  } = shell
  /**
   * The "..." button itself is what the git menu opens from — not the toolbar around it, which
   * starts at the far left of the pane and so put the menu at the opposite end from the button
   * that opened it.
   */
  const gitMenuButtonRef = useRef<HTMLButtonElement>(null)
  /** The box the terminal list opens upward from — see the positioning note in GitMenu. */
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const { gitBusy, runGitAction, branchPicker, setBranchPicker, gitMenuOpen, setGitMenuOpen } = git

  return (
    <>
      {shellOpen && (
        <div
          className="bottom-resizer"
          data-testid="bottom-resizer"
          // UI-27: was a mouse-only drag handle with no role or keyboard alternative.
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={MIN_BOTTOM_HEIGHT}
          aria-valuemax={MAX_BOTTOM_HEIGHT}
          aria-valuenow={bottomHeight}
          aria-label="Resize the terminal pane"
          tabIndex={0}
          onMouseDown={(e) => { e.preventDefault(); onStartBottomResize() }}
          onKeyDown={(e) => {
            // Dragging up (a smaller clientY) grows the pane — see App.tsx's own comment on
            // the drag effect this mirrors — so ArrowUp is the "bigger" direction here too.
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            e.preventDefault()
            onBottomHeightStep(e.key === 'ArrowUp' ? 16 : -16)
          }}
        />
      )}

      {/* UI-6: `var(--drag-bottom-height, …)` reads the live value App's resize drag writes
          straight onto the document root while dragging, falling back to the committed
          `bottomHeight` prop otherwise — the same fallback pattern as the sidebar's width. */}
      <div
        className="bottom-pane shell-card"
        data-testid="shell-card"
        style={{ height: shellOpen ? `var(--drag-bottom-height, ${String(bottomHeight)}px)` : 32 }}
      >
        <div className="toolbar-anchor" ref={toolbarRef}>
        <Toolbar
          left={[
            {
              id: 'shell-toggle',
              // Rotates like every other chevron in the app instead of always pointing down,
              // so the button states which way it will move the pane.
              icon: <ChevronIcon expanded={shellOpen} />,
              label: shellOpen ? 'Hide shell' : 'Show shell',
              title: shellOpen ? 'Hide shell' : 'Show shell',
              testId: 'shell-toggle',
              onClick: () => { void shell.toggleShell() },
            },
            ...(gitStatus !== null
              ? ([
                  {
                    id: 'git-branch',
                    icon: <BranchIcon />,
                    label:
                      gitStatus.branch === null
                        ? 'HEAD (detached)'
                        : gitStatus.branch +
                          (gitStatus.hasUpstream && (gitStatus.behind > 0 || gitStatus.ahead > 0)
                            ? ` (${gitStatus.behind > 0 ? '↓' + String(gitStatus.behind) : ''}${gitStatus.ahead > 0 ? '↑' + String(gitStatus.ahead) : ''})`
                            : ''),
                    title: 'Switch or create branch',
                    testId: 'toolbar-branch-button',
                    active: branchPicker !== null,
                    onClick: () => setBranchPicker('checkout'),
                  },
                  {
                    id: 'git-pull',
                    icon: <ArrowDownIcon className={gitBusy === 'pull' ? 'spinner' : undefined} />,
                    title: 'Pull',
                    testId: 'toolbar-pull',
                    disabled: gitBusy !== null,
                    onClick: () => { void runGitAction('pull') },
                  },
                  {
                    id: 'git-push',
                    icon: <ArrowUpIcon className={gitBusy === 'push' ? 'spinner' : undefined} />,
                    title: 'Push',
                    testId: 'toolbar-push',
                    disabled: gitBusy !== null,
                    onClick: () => { void runGitAction('push') },
                  },
                  {
                    id: 'git-copy',
                    icon: <CopyIcon />,
                    title: 'Copy branch name',
                    testId: 'toolbar-copy',
                    disabled: gitStatus.branch === null,
                    onClick: () => {
                      if (gitStatus.branch !== null) void window.apiary.copyToClipboard(gitStatus.branch)
                    },
                  },
                  {
                    id: 'git-more',
                    buttonRef: gitMenuButtonRef,
                    icon: <EllipsisIcon />,
                    title: 'More git commands',
                    testId: 'toolbar-git-menu',
                    active: gitMenuOpen,
                    onClick: () => setGitMenuOpen((v) => !v),
                  },
                ] as ToolbarButtonSpec[])
              : []),
            // Plugin buttons sit after git's, at the end of the left group: they are about the
            // same checkout, and anything contributed belongs after what Apiary itself owns.
            ...pluginButtons(pluginItems),
          ]}
          right={[
            {
              id: 'terminal-add',
              icon: <PlusIcon />,
              title: 'New terminal',
              testId: 'terminal-add',
              onClick: () => { void shell.addTerminalTab() },
            },
            {
              id: 'terminal-list-toggle',
              icon: <ListIcon />,
              title: 'Toggle terminal list',
              testId: 'terminal-list-toggle',
              active: tabListOpen,
              onClick: () => setTabListOpen((v) => !v),
            },
          ]}
        />
        </div>
        {gitMenuOpen && (
          <GitMenu
            items={git.gitMenuItems}
            anchorRef={gitMenuButtonRef}
            onClose={() => setGitMenuOpen(false)}
          />
        )}
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
