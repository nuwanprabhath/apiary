import type { JSX } from 'react'
import type { ProjectNode } from '@shared/types'
import { CollapseAllIcon, PlusBoldIcon } from '../../ui/icons'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { editableOf } from '../../ui/editableText'
import { moveGroupBefore, type GroupState, type SessionGroup } from '../../state/groups'
import { allFolderPaths } from './treeUtils'
import type { GroupActions } from './useGroupActions'
import { focusAskedFor } from '../../ui/focusUnlessTyping'

function GroupRenameInput({ draft, onDraft, onCommit, onCancel }: {
  draft: string
  onDraft: (next: string) => void
  onCommit: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <input
      ref={focusAskedFor}
      className="search folder-group-rename"
      data-testid="folder-group-rename"
      value={draft}
      onChange={(e) => onDraft(e.target.value)}
      onBlur={(e) => {
        // Focus moving into a menu opened over the rename is not the rename ending.
        if (e.relatedTarget instanceof Element && e.relatedTarget.closest('[role="menu"]') !== null) return
        onCommit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        // Stopped so Escape cancels just the rename, not a layer open on the shared Escape stack.
        if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
      }}
    />
  )
}

export function FolderGroupHeader({
  group, folders, open, groupState, groups, collapsed, onCollapsedChange,
  tabIndex, onMenu, onNewSessionInPickedFolder,
}: {
  group: SessionGroup
  folders: ProjectNode[]
  open: boolean
  groupState: GroupState
  groups: GroupActions
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  tabIndex: number
  onMenu: (x: number, y: number) => void
  /** Resolves the picked folder, or null. */
  onNewSessionInPickedFolder?: () => Promise<string | null>
}): JSX.Element {
  const { patchGroups, assignFolder, renamingGroup, setRenamingGroup, renameDraft, setRenameDraft, commitRename } = groups
  return (
    <div
      className="folder-group-header-wrap"
      data-group-id={group.id}
      role="treeitem"
      // Stable, like the other rows': renaming swaps the header for an input.
      aria-label={group.name}
      aria-expanded={open}
      aria-level={1}
      data-tree-kind="group"
      data-own-context-menu
      data-tree-key={group.id}
      tabIndex={tabIndex}
      // The menu keeps Move up/down for keyboard and precision.
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
        // The rename box is a text field: its menu is the text menu, so the default is left alone.
        if (editableOf(e.target) !== null) return
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
    >
      {renamingGroup === group.id ? (
        <GroupRenameInput
          draft={renameDraft}
          onDraft={setRenameDraft}
          onCommit={() => commitRename(group.id)}
          onCancel={() => setRenamingGroup(null)}
        />
      ) : (
        <button
          className="folder-group-header"
          data-testid="folder-group-toggle"
          aria-expanded={open}
          // The wrap is the treeitem, whose Enter/ArrowRight/ArrowLeft already toggle this.
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
            // A group is not a folder, so its "+" asks which one (even one Apiary has never
            // seen) and files it here once the session has started.
            void onNewSessionInPickedFolder().then((folder) => {
              if (folder !== null) assignFolder(folder, group.id)
            })
          }}
        >
          <PlusBoldIcon />
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
            // Every folder in the group at every depth is closed, and the group itself opened.
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
  )
}
