import { type JSX, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import { ContextMenu } from '../../ui/ContextMenu'
import { HoverCard } from '../../ui/HoverCard'
import { CollapseAllIcon, PlusBoldIcon } from '../../ui/icons'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { useNotifications } from '../../ui/notifications'
import { pullFolder } from '../../state/git'

/** A folder's hover card: its full path and branch, and a pull for the branch. */
export function FolderHoverCard({ node, anchor, keepOpen, scheduleClose }: {
  node: ProjectNode
  anchor: DOMRect
  keepOpen: () => void
  scheduleClose: () => void
}): JSX.Element {
  const { notify, notifyError } = useNotifications()
  return (
    <HoverCard
      testId="folder-hover-card"
      anchor={anchor}
      title={node.label}
      path={node.path}
      branch={node.branch}
      lastActive={null}
      onPullBranch={node.branch === null ? undefined : async () => {
        try {
          const { commits } = await pullFolder(node.path)
          notify({
            message: commits === 0
              ? `${node.label} is already up to date with ${node.branch ?? 'its upstream'}`
              : `Pulled ${String(commits)} commit${commits === 1 ? '' : 's'} into ${node.label}`,
          })
        } catch (e: unknown) {
          notifyError(e, `Could not pull ${node.branch ?? 'the branch'} into ${node.label}`)
        }
      }}
      onPointerEnter={keepOpen}
      onPointerLeave={scheduleClose}
    />
  )
}

/** A folder row's buttons: the toggle, collapse-all and "+" (a session here, or a new worktree). */
export function FolderRowControls({
  node, isOpen, isGit, onToggle, onNewSession, onNewWorktree, onCollapseBeneath,
}: {
  node: ProjectNode
  isOpen: boolean
  isGit: boolean
  onToggle: (path: string) => void
  onNewSession: (path: string) => void
  onNewWorktree?: (path: string, label: string) => void
  /** Present only on a folder that has folders beneath it. */
  onCollapseBeneath?: () => void
}): JSX.Element {
  // "+" on a git folder is a choice — a session here, or a new worktree of this repository (the
  // simple-worktrees extension's "+"). Anywhere else it only ever meant one thing, and still
  // starts the session straight away.
  const [plusMenu, setPlusMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <button
        className="project-row"
        data-testid="project-toggle"
        onClick={() => onToggle(node.path)}
        aria-expanded={isOpen}
        // The wrap above is the treeitem, and Enter/ArrowRight/ArrowLeft on it already
        // toggle the same state — a second Tab stop here would be redundant.
        tabIndex={-1}
      >
        <ChevronIcon expanded={isOpen} />
        <span className="project-label">{node.label}</span>
        {node.branch !== null && <span className="branch">{node.branch}</span>}
      </button>
      {onCollapseBeneath !== undefined && (
        <button
          className="new-session-button collapse-all-button"
          data-testid="collapse-all-button"
          title={`Collapse all folders in ${node.label}`}
          aria-label={`Collapse all folders in ${node.label}`}
          onClick={(e) => {
            e.stopPropagation()
            onCollapseBeneath()
          }}
        >
          <CollapseAllIcon />
        </button>
      )}
      <button
        className="new-session-button"
        data-testid="new-session-button"
        title={`New Claude Code session in ${node.label}`}
        aria-label={`New Claude Code session in ${node.label}`}
        aria-haspopup={isGit && onNewWorktree !== undefined ? 'menu' : undefined}
        onClick={(e) => {
          e.stopPropagation()
          if (!isGit || onNewWorktree === undefined) {
            onNewSession(node.path)
            return
          }
          const r = e.currentTarget.getBoundingClientRect()
          setPlusMenu({ x: r.left, y: r.bottom + 2 })
        }}
      >
        <PlusBoldIcon />
      </button>
      {/* Mounted only while open: one per folder row otherwise, each with its own hooks. */}
      {plusMenu !== null && <ContextMenu
        testId="new-in-folder-menu"
        position={plusMenu}
        onClose={() => { setPlusMenu(null) }}
        items={[
          { id: 'new-session', label: 'New Claude session here', run: () => { onNewSession(node.path) } },
          { id: 'new-worktree', label: 'New worktree…', run: () => { onNewWorktree?.(node.path, node.label) } },
        ]}
      />}
    </>
  )
}
