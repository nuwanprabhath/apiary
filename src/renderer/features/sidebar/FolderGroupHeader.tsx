import type { JSX } from 'react'
import type { ProjectNode } from '@shared/types'
import { CollapseAllIcon, PlusBoldIcon } from '../../ui/icons'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { editableOf } from '../../ui/editableText'
import { moveGroupBefore, type GroupState, type SessionGroup } from '../../state/groups'
import { allFolderPaths } from './treeUtils'
import type { GroupActions } from './useGroupActions'

/** The in-place rename box of a group heading. */
function GroupRenameInput({ draft, onDraft, onCommit, onCancel }: {
  draft: string
  onDraft: (next: string) => void
  onCommit: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <input
      // eslint-disable-next-line apiary/focus-unless-typing -- the user just chose Rename, so the field is what they asked for
      autoFocus
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
        // Stopped rather than left to bubble: this rename can be in progress while
        // some other layer is open on the shared Escape stack (UI-13), and Escape
        // should cancel just the rename, not also close that layer.
        if (e.key === 'Escape') { e.stopPropagation(); onCancel() }
      }}
    />
  )
}

/** A group's heading row: the treeitem (rename in place, drag to reorder) with its "+" and collapse-all buttons. */
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
  /** The header's roving-tabindex value in the sidebar's one tree. */
  tabIndex: number
  onMenu: (x: number, y: number) => void
  /** A group's "+": pick a folder, start a session there. Resolves the folder, or null. */
  onNewSessionInPickedFolder?: () => Promise<string | null>
}): JSX.Element {
  const { patchGroups, assignFolder, renamingGroup, setRenamingGroup, renameDraft, setRenameDraft, commitRename } = groups
  return (
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
      data-own-context-menu
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
  )
}
