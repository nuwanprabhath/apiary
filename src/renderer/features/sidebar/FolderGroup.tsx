import { type ComponentProps, type JSX, useState } from 'react'
import type { ProjectNode } from '@shared/types'
import type { GroupState, SessionGroup } from '../../state/groups'
import { FolderGroupHeader } from './FolderGroupHeader'
import { SessionTree } from './SessionTree'
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
  const { assignFolder, topLevelPaths } = groups
  /** Whether a folder is being dragged over the section, so the whole section can light up. */
  const [dropInto, setDropInto] = useState(false)
  return (
    <section
      className="folder-group"
      data-testid="folder-group"
      data-drop-into={dropInto}
      // The drop target is the whole section: an empty group is only a heading and a line of text.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-apiary-folder')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropInto(true)
      }}
      onDragLeave={(e) => {
        // A row inside fires dragleave for the child on the way past; only leaving the section counts.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropInto(false)
      }}
      onDrop={(e) => {
        setDropInto(false)
        const dragged = e.dataTransfer.getData('application/x-apiary-folder')
        // Only a top-level folder can be filed into a group: a worktree belongs to its repository.
        if (dragged === '' || !topLevelPaths.has(dragged)) return
        e.preventDefault()
        assignFolder(dragged, group.id)
      }}
    >
      <FolderGroupHeader
        group={group} folders={folders} open={open} groupState={groupState} groups={groups}
        collapsed={collapsed} onCollapsedChange={onCollapsedChange} tabIndex={tabIndex}
        onMenu={onMenu} onNewSessionInPickedFolder={onNewSessionInPickedFolder}
      />
      {/* level=2: one deeper than the group header (level 1); see `SessionTree`'s `level` prop. */}
      {open && folders.length > 0 && <SessionTree nodes={folders} {...treeProps} level={2} />}
      {open && folders.length === 0 && (
        <p className="folder-group-empty muted" data-testid="folder-group-empty">
          Drag a folder here.
        </p>
      )}
    </section>
  )
}
