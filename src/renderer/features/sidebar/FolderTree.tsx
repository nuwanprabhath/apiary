import type { JSX } from 'react'
import type { ProjectNode } from '@shared/types'
import { FolderGroup, type SharedTreeProps } from './FolderGroup'
import type { GroupState } from '../../state/groups'
import { SessionTree } from './SessionTree'
import type { SidebarMenu } from './sidebarMenuItems'
import type { GroupActions } from './useGroupActions'
import type { useMainTreeNav } from './useMainTreeNav'

/**
 * The whole folder/session/group hierarchy as one WAI-ARIA tree (UI-27 steps 1-2 — see
 * `useMainTreeNav`): the user's groups first, then every folder not filed in one.
 */
export function FolderTree({
  mainTree, arranged, groupState, groups, collapsed, onCollapsedChange, treeProps, setMenu, onNewSessionInPickedFolder,
}: {
  mainTree: ReturnType<typeof useMainTreeNav>
  arranged: {
    groups: { group: { id: string; name: string }; folders: ProjectNode[] }[]
    ungrouped: ProjectNode[]
  }
  groupState: GroupState
  groups: GroupActions
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  treeProps: SharedTreeProps
  setMenu: (menu: SidebarMenu | null) => void
  onNewSessionInPickedFolder?: () => Promise<string | null>
}): JSX.Element {
  const groupsCollapsed = new Set(groupState.collapsed)
  return (
    <div
      role="tree"
      aria-label="Sessions"
      ref={mainTree.ref}
      onKeyDown={mainTree.onKeyDown}
      onFocus={mainTree.onFocus}
    >
      {arranged.groups.map(({ group, folders }) => (
        <FolderGroup
          key={group.id}
          group={group}
          folders={folders}
          open={!groupsCollapsed.has(group.id)}
          groupState={groupState}
          groups={groups}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
          treeProps={treeProps}
          tabIndex={mainTree.tabIndexFor('group', group.id)}
          onMenu={(x, y) => setMenu({ kind: 'group', id: group.id, x, y })}
          onNewSessionInPickedFolder={onNewSessionInPickedFolder}
        />
      ))}

      {arranged.ungrouped.length > 0 && <SessionTree nodes={arranged.ungrouped} {...treeProps} />}
    </div>
  )
}
