import { type JSX, type RefObject, useMemo, useRef } from 'react'
import type { GitStatus } from '@shared/types'
import type { PluginBarItemPayload } from '@shared/api'
import { Toolbar, type ToolbarButtonSpec } from './Toolbar'
import { pluginButtons } from './pluginBar'
import { GitMenu } from '../git'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { BranchIcon, ArrowDownIcon, ArrowUpIcon, CopyIcon, PlusIcon, ListIcon, EllipsisIcon } from '../../ui/icons'
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

/** Copy-branch, pinned right after the branch name it copies (always visible, at the muted colour). */
function copyBranchButton(gitStatus: GitStatus): ToolbarButtonSpec {
  return {
    id: 'git-copy',
    icon: <CopyIcon />,
    title: gitStatus.branch === null ? 'Copy branch name (HEAD is detached: no branch)' : 'Copy branch name',
    testId: 'toolbar-copy',
    disabled: gitStatus.branch === null,
    onClick: () => {
      if (gitStatus.branch !== null) void copyText(gitStatus.branch)
    },
  }
}

/** Pull, push and the "..." button: the git half of the toolbar's right side. */
function gitButtons(
  git: GitActions,
  gitMenuButtonRef: RefObject<HTMLButtonElement | null>,
): ToolbarButtonSpec[] {
  const { gitBusy, runGitAction, gitMenuOpen, setGitMenuOpen } = git
  const pulling = gitBusy === 'pull'
  const pushing = gitBusy === 'push'
  return [
    {
      id: 'git-pull',
      icon: <ArrowDownIcon className={pulling ? 'spinner' : undefined} />,
      title: pulling ? 'Pulling…' : gitBusy !== null ? 'Pull (a git command is running)' : 'Pull',
      testId: 'toolbar-pull',
      disabled: gitBusy !== null,
      priority: 4,
      onClick: () => { void runGitAction('pull') },
    },
    {
      id: 'git-push',
      icon: <ArrowUpIcon className={pushing ? 'spinner' : undefined} />,
      title: gitBusy !== null ? 'Push (a git command is running)' : 'Push',
      testId: 'toolbar-push',
      disabled: gitBusy !== null,
      priority: 5,
      onClick: () => { void runGitAction('push') },
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
  ]
}

/** The shell card's toolbar (shell toggle, branch, git and plugin buttons, new terminal, list
 *  toggle) and the git menu that opens from it. */
export function ShellToolbar({ shell, git, gitStatus, pluginItems }: {
  shell: ShellTerminals
  git: GitActions
  gitStatus: GitStatus | null
  pluginItems: PluginBarItemPayload[]
}): JSX.Element {
  const { shellOpen, tabListOpen, setTabListOpen } = shell
  /**
   * The git menu opens from the "..." button itself, not the toolbar around it, which starts at the
   * far left of the pane.
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
  const { branchPicker, setBranchPicker, gitMenuOpen, setGitMenuOpen } = git

  return (
    <>
      <div className="toolbar-anchor" ref={toolbarRef}>
        <Toolbar
          moreRef={moreButtonRef}
          left={[
            {
              id: 'shell-toggle',
              // The word hides whole before anything else is cut, leaving the chevron.
              icon: <ChevronIcon expanded={shellOpen} />,
              label: 'Shell',
              labelMode: 'collapse',
              expanded: shellOpen,
              title: shellOpen ? 'Hide shell' : 'Show shell',
              testId: 'shell-toggle',
              onClick: () => { void shell.toggleShell() },
            },
            ...(gitStatus !== null
              ? [branchChip(gitStatus, branchPicker !== null, () => setBranchPicker('checkout')), copyBranchButton(gitStatus)]
              : []),
          ]}
          right={[
            ...(gitStatus !== null ? gitButtons(git, gitMenuButtonRef) : []),
            // Contributed buttons sit after what Apiary itself owns.
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
    </>
  )
}
