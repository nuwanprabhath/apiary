import { type ComponentProps, type JSX, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import { CollapseAllIcon } from '../../ui/icons'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { moveGroupBefore, type GroupState, type SessionGroup } from './model/groups'
import { SessionTree } from './SessionTree'
import { allFolderPaths } from './treeUtils'
import type { GroupActions } from './useGroupActions'

/** The tree props every level shares, so the grouped and ungrouped renders cannot drift apart. */
export type SharedTreeProps = Omit<ComponentProps<typeof SessionTree>, 'nodes' | 'level' | 'depth'>

/** One named group: its heading (rename in place, "+", collapse all) and the folders filed in it. */
export function FolderGroup({
  group, folders, open, groupState, groups, collapsed, onCollapsedChange, treeProps,
  tabIndex, onMenu, onNewSessionInPickedFolder,
}: {
  group: SessionGroup
  folders: ProjectNode[]
  open: boolean
  groupState: GroupState
  groups: GroupActions
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  treeProps: SharedTreeProps
  /** The group header's roving-tabindex value in the sidebar's one tree. */
  tabIndex: number
  onMenu: (x: number, y: number) => void
  /** A group's "+": pick a folder, start a session there. Resolves the folder, or null. */
  onNewSessionInPickedFolder?: () => Promise<string | null>
}): JSX.Element {
  const { patchGroups, assignFolder, renamingGroup, setRenamingGroup, renameDraft, setRenameDraft, commitRename, topLevelPaths } = groups
  /** Whether a folder is being dragged over the section, so the whole section can light up. */
  const [dropInto, setDropInto] = useState(false)
  return (
    <section
      className="folder-group"
      data-testid="folder-group"
      data-drop-into={dropInto}
      // The drop target is the whole section, not just its heading: an empty group is
      // a heading and a line of placeholder text, and aiming at the heading alone meant
      // the one case that needs dragging most — filing the first folder into a new,
      // empty group — had almost nothing to aim at.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-apiary-folder')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropInto(true)
      }}
      onDragLeave={(e) => {
        // Only when the pointer has left the section itself, not merely moved onto a
        // row inside it, which fires dragleave for the child on the way past.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropInto(false)
      }}
      onDrop={(e) => {
        setDropInto(false)
        const dragged = e.dataTransfer.getData('application/x-apiary-folder')
        // Only a top-level folder can be filed into a group: a worktree belongs to its
        // repository, and dropping one on the group's whitespace must not quietly move
        // it out from under the repository it is part of.
        if (dragged === '' || !topLevelPaths.has(dragged)) return
        e.preventDefault()
        assignFolder(dragged, group.id)
      }}
    >
      <div
        className="folder-group-header-wrap"
        data-group-id={group.id}
        role="treeitem"
        // Stable, like the folder and session rows' — a renaming group swaps its header
        // for an input, which must not also change the treeitem's own accessible name.
        aria-label={group.name}
        aria-expanded={open}
        aria-level={1}
        data-tree-kind="group"
        data-tree-key={group.id}
        tabIndex={tabIndex}
        // Groups reorder by dragging their headings, the same gesture as everything else
        // in this sidebar; the menu keeps Move up/down for keyboard and precision.
        draggable={renamingGroup !== group.id}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-apiary-group', group.id)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('application/x-apiary-group')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          const dragged = e.dataTransfer.getData('application/x-apiary-group')
          if (dragged === '' || dragged === group.id) return
          e.preventDefault()
          e.stopPropagation() // Not also a folder drop into this group.
          patchGroups({ groups: moveGroupBefore(groupState.groups, dragged, group.id) })
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(e.clientX, e.clientY)
        }}
      >
        {renamingGroup === group.id ? (
          <input
            className="search folder-group-rename"
            data-testid="folder-group-rename"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => commitRename(group.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(group.id)
              // Stopped rather than left to bubble: this rename can be in progress while
              // some other layer is open on the shared Escape stack (UI-13), and Escape
              // should cancel just the rename, not also close that layer.
              if (e.key === 'Escape') { e.stopPropagation(); setRenamingGroup(null) }
            }}
          />
        ) : (
          <button
            className="folder-group-header"
            data-testid="folder-group-toggle"
            aria-expanded={open}
            // UI-27: the wrap above is the treeitem, whose Enter/ArrowRight/ArrowLeft
            // already toggle the same state.
            tabIndex={-1}
            onClick={() => patchGroups({
              collapsed: open
                ? [...groupState.collapsed, group.id]
                : groupState.collapsed.filter((id) => id !== group.id),
            })}
          >
            <ChevronIcon expanded={open} />
            <span className="folder-group-label">{group.name}</span>
            <span className="pinned-count">{folders.length}</span>
          </button>
        )}
        {renamingGroup !== group.id && onNewSessionInPickedFolder !== undefined && (
          <button
            className="new-session-button"
            data-testid="group-new-session-button"
            title={`New Claude Code session in a folder, filed under ${group.name}`}
            aria-label={`New Claude Code session in a folder, filed under ${group.name}`}
            onClick={(e) => {
              e.stopPropagation()
              // A group is the user's own arrangement, not a folder, so its "+" asks
              // which folder — any folder, even one Apiary has never seen — and files
              // it here once the session has started.
              void onNewSessionInPickedFolder().then((folder) => {
                if (folder !== null) assignFolder(folder, group.id)
              })
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {folders.length > 0 && renamingGroup !== group.id && (
          <button
            className="new-session-button collapse-all-button"
            data-testid="group-collapse-all-button"
            title={`Collapse all folders in ${group.name}`}
            aria-label={`Collapse all folders in ${group.name}`}
            onClick={(e) => {
              e.stopPropagation()
              // Every folder in the group, at every depth, and the group itself opened —
              // what the folder rows' own button does one level down: the click asks to
              // see the list of folders, closed.
              const next = new Set(collapsed)
              for (const p of allFolderPaths(folders)) next.add(p)
              onCollapsedChange(next)
              if (!open) {
                patchGroups({ collapsed: groupState.collapsed.filter((id) => id !== group.id) })
              }
            }}
          >
            <CollapseAllIcon />
          </button>
        )}
      </div>
      {/* level=2: nested one deeper than the group header owning it (level 1) — see the
       *  note on `SessionTree`'s `level` prop for why this is kept apart from `depth`. */}
      {open && folders.length > 0 && <SessionTree nodes={folders} {...treeProps} level={2} />}
      {open && folders.length === 0 && (
        <p className="folder-group-empty muted" data-testid="folder-group-empty">
          Drag a folder here.
        </p>
      )}
    </section>
  )
}
