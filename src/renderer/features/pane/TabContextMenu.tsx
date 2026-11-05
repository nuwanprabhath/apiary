import type { JSX } from 'react'
import { hasSeveralAccounts, useAccounts, useSessionAccount } from '../../state/accountsStore'
import { pickAccount, sessionOfTabKey } from '../../state/sessionBusy'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { useNotifications } from '../../ui/notifications'
import { reloadSession } from '../../state/sessions'
import { useWorkspaceSelector } from '../workspace'

interface Props {
  /** The tab the menu was opened on and where; null: closed. */
  menu: { key: string; x: number; y: number } | null
  /** Whether a tab has no session id yet (so it cannot be forked or detached). */
  isPending: (key: string) => boolean
  pinnedKeys: Set<string>
  onClose: (key: string) => void
  onTogglePin: (key: string) => void
  onFork: (key: string) => void
  onDetach: (key: string, at: { x: number; y: number }) => void
  /** Opens the layout picker for the tab, at a point. */
  onArrange: (key: string, at: { x: number; y: number }) => void
  onDismiss: () => void
}

/** The right-click menu of a session tab. */
export function TabContextMenu(
  { menu, isPending, pinnedKeys, onClose, onTogglePin, onFork, onDetach, onArrange, onDismiss }: Props,
): JSX.Element {
  const accounts = useAccounts()
  // Which `new:` pty a tab's session started on (`ptyOverrides`), for Reload.
  const ptyOverrides = useWorkspaceSelector((s) => s.ptyOverrides)
  const { notify, notifyError } = useNotifications()
  // A session tab's key is its session id; a new session has none yet, so it has nothing to switch.
  const sessionId = menu === null || isPending(menu.key) ? null : sessionOfTabKey(menu.key)
  const currentId = useSessionAccount(sessionId)
  const accountItem: ContextMenuItem[] = sessionId === null || !hasSeveralAccounts(accounts) ? [] : [{
    id: 'account',
    label: 'Account',
    submenu: accounts.accounts.map((a) => ({
      id: `account-${a.id}`,
      label: a.label,
      checked: a.id === currentId,
      run: () => { if (a.id !== currentId) pickAccount(sessionId, a.id) },
    })),
  }]
  return (
    <ContextMenu
      testId="tab-menu"
      position={menu === null ? null : { x: menu.x, y: menu.y }}
      onClose={onDismiss}
      items={menu === null ? [] : [
        {
          id: 'fork',
          label: 'Fork session',
          // A session that has not written its JSONL yet has no id to fork from — Claude mints
          // that when it first saves, and `--resume` needs one.
          disabled: isPending(menu.key),
          disabledReason: 'Available once the session has started — send it a message first',
          run: () => onFork(menu.key),
        },
        {
          id: 'reload',
          label: 'Reload session',
          // Claude reads its settings and MCP servers when it starts: a server added since is
          // reached only by starting it again, on the same conversation.
          disabled: sessionId === null,
          disabledReason: 'Available once the session has started — send it a message first',
          run: () => {
            if (sessionId === null) return
            const ptyId = ptyOverrides.get(menu.key) ?? null
            reloadSession(sessionId, ptyId).then((what) => {
              notify({
                kind: what === 'none' ? 'info' : 'success',
                message: what === 'none'
                  ? 'Claude is not running for this session. It loads your MCP servers and settings when it next starts.'
                  : 'Session reloaded: Claude started again on the same conversation, with your current MCP servers and settings.',
              })
            }, (e: unknown) => { notifyError(e, 'Could not reload this session') })
          },
        },
        ...accountItem,
        {
          id: 'detach',
          label: 'Move into New Window',
          // Same reason as forking: the new window opens a *session*, and a tab that has not
          // written its JSONL yet has no session id to open — detaching one would leave an
          // empty window and take the tab out of this one on the way.
          disabled: isPending(menu.key),
          disabledReason: 'Available once the session has started — send it a message first',
          run: () => onDetach(menu.key, { x: menu.x, y: menu.y }),
        },
        {
          id: 'arrange',
          label: 'Arrange…',
          run: () => { onArrange(menu.key, { x: menu.x, y: menu.y }) },
        },
        {
          id: 'pin',
          separator: true,
          label: pinnedKeys.has(menu.key) ? 'Unpin from sidebar' : 'Pin to sidebar',
          run: () => onTogglePin(menu.key),
        },
        { id: 'close', label: 'Close', separator: true, run: () => onClose(menu.key) },
      ]}
    />
  )
}
