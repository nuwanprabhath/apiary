import { type JSX, type RefObject, useMemo, useRef } from 'react'
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
import type { ResizeSeparatorProps } from '../../ui/useResizeDrag'
import type { ShellTerminals } from './useShellTerminals'
import type { GitActions } from './useGitActions'
import { copyText } from '../../state/clipboard'

/** The branch: its icon and name (narrowing, the full name in the title) and the behind/ahead count as a badge. */
function branchChip(gitStatus: GitStatus, active: boolean, onClick: () => void): ToolbarButtonSpec {
  const counts = gitStatus.hasUpstream
    ? (gitStatus.behind > 0 ? '↓' + String(gitStatus.behind) : '') + (gitStatus.ahead > 0 ? '↑' + String(gitStatus.ahead) : '')
    : ''
  const name = gitStatus.branch ?? 'HEAD (detached)'
  return {
    id: 'git-branch',
    icon: <BranchIcon />,
    label: name,
    labelMode: 'shrink',
    badge: counts === '' ? undefined : counts,
    title: `${name} — switch or create branch`,
    testId: 'toolbar-branch-button',
    active,
    onClick,
  }
}

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
  /**
   * The "..." button itself is what the git menu opens from — not the toolbar around it, which
   * starts at the far left of the pane and so put the menu at the opposite end from the button
   * that opened it.
   */
  const gitMenuButtonRef = useRef<HTMLButtonElement>(null)
  /** The » button: the git menu opens from it while its own button is in the overflow menu. */
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const gitMenuAnchor = useMemo<RefObject<HTMLElement | null>>(
    () => ({ get current() { return gitMenuButtonRef.current ?? moreButtonRef.current } }),
    [],
  )
  /** The box the terminal list opens upward from — see the positioning note in GitMenu. */
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const { gitBusy, runGitAction, branchPicker, setBranchPicker, gitMenuOpen, setGitMenuOpen } = git

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
        <div className="toolbar-anchor" ref={toolbarRef}>
        <Toolbar
          moreRef={moreButtonRef}
          left={[
            {
              id: 'shell-toggle',
              // Rotates like every other chevron in the app (⌄ open, › closed), so the button
              // states which way it will move the pane. The word hides whole before anything else
              // is cut, leaving the chevron.
              icon: <ChevronIcon expanded={shellOpen} />,
              label: 'Shell',
              labelMode: 'collapse',
              expanded: shellOpen,
              title: shellOpen ? 'Hide shell' : 'Show shell',
              testId: 'shell-toggle',
              onClick: () => { void shell.toggleShell() },
            },
            ...(gitStatus !== null ? [branchChip(gitStatus, branchPicker !== null, () => setBranchPicker('checkout'))] : []),
          ]}
          right={[
            ...(gitStatus !== null
              ? ([
                  {
                    id: 'git-pull',
                    icon: <ArrowDownIcon className={gitBusy === 'pull' ? 'spinner' : undefined} />,
                    title: gitBusy === 'pull' ? 'Pulling…' : gitBusy !== null ? 'Pull (a git command is running)' : 'Pull',
                    testId: 'toolbar-pull',
                    disabled: gitBusy !== null,
                    priority: 4,
                    onClick: () => { void runGitAction('pull') },
                  },
                  {
                    id: 'git-push',
                    icon: <ArrowUpIcon className={gitBusy === 'push' ? 'spinner' : undefined} />,
                    title: gitBusy !== null ? 'Push (a git command is running)' : 'Push',
                    testId: 'toolbar-push',
                    disabled: gitBusy !== null,
                    priority: 5,
                    onClick: () => { void runGitAction('push') },
                  },
                  {
                    id: 'git-copy',
                    icon: <CopyIcon />,
                    title: gitStatus.branch === null ? 'Copy branch name (HEAD is detached: no branch)' : 'Copy branch name',
                    testId: 'toolbar-copy',
                    disabled: gitStatus.branch === null,
                    priority: 7,
                    onClick: () => {
                      if (gitStatus.branch !== null) void copyText(gitStatus.branch)
                    },
                  },
                  {
                    id: 'git-more',
                    buttonRef: gitMenuButtonRef,
                    icon: <EllipsisIcon />,
                    title: 'More git commands',
                    testId: 'toolbar-git-menu',
                    active: gitMenuOpen,
                    priority: 6,
                    onClick: () => setGitMenuOpen((v) => !v),
                  },
                ] as ToolbarButtonSpec[])
              : []),
            // Plugin buttons sit after git's: they are about the same checkout, and anything
            // contributed belongs after what Apiary itself owns.
            ...pluginButtons(pluginItems).map((spec) => ({ ...spec, priority: 3 })),
            {
              id: 'terminal-add',
              icon: <PlusIcon />,
              title: 'New terminal',
              testId: 'terminal-add',
              priority: 1,
              onClick: () => { void shell.addTerminalTab() },
            },
            {
              id: 'terminal-list-toggle',
              icon: <ListIcon />,
              title: 'Toggle terminal list',
              testId: 'terminal-list-toggle',
              active: tabListOpen,
              priority: 2,
              onClick: () => setTabListOpen((v) => !v),
            },
          ]}
        />
        </div>
        {gitMenuOpen && (
          <GitMenu
            items={git.gitMenuItems}
            anchorRef={gitMenuAnchor}
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
