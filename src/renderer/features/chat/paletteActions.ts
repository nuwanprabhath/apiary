import type { AccountInfo, AccountsState } from '@shared/domain/accounts'
import type { SessionId } from '@shared/domain/ids'
import { fuzzyScore } from '@shared/fuzzy'
import { hasSeveralAccounts } from '../../state/accountsStore'
import { openSessionInVsCode, reloadSession } from '../../state/sessions'
import { surface } from '../../state/policy'

/** What decides whether an action is offered for this chat. */
export interface PaletteContext {
  sessionId: SessionId
  vsCodeAvailable: boolean
  /** The session's folder is still on disk. */
  folderExists: boolean
  /** Every account, and the one this session runs under (null while it loads). */
  accounts: AccountsState
  account: AccountInfo | null
}

/** One entry of the "/" menu's Actions group. The next action is one more entry in `PALETTE_ACTIONS`. */
export interface PaletteAction {
  id: string
  label: (ctx: PaletteContext) => string
  description: (ctx: PaletteContext) => string
  /** Choosing it opens a list inside the menu (`CommandPalette`) instead of running. */
  opensList?: boolean
  /** Absent from the menu, not disabled, when false. */
  available: (ctx: PaletteContext) => boolean
  run: (ctx: PaletteContext) => void
}

const OPEN_IN_VS_CODE: PaletteAction = {
  id: 'open-in-vscode',
  label: () => 'Open in VS Code',
  description: () => 'This session’s folder',
  // The sidebar row's VS Code button has the same condition.
  available: (ctx) => ctx.vsCodeAvailable && ctx.folderExists,
  run: (ctx) => { openSessionInVsCode(ctx.sessionId) },
}

/** First in the group: the account this session runs under, and a list to pick another from. */
const ACCOUNT: PaletteAction = {
  id: 'account',
  label: (ctx) => `Account: ${ctx.account?.label ?? '…'}`,
  description: (ctx) => (ctx.account === null ? '' : ctx.account.email ?? 'Not logged in'),
  opensList: true,
  available: (ctx) => hasSeveralAccounts(ctx.accounts),
  run: () => {},
}

/** Starts this chat's claude again on the same conversation, so an MCP server added since loads. */
const RELOAD: PaletteAction = {
  id: 'reload-session',
  label: () => 'Reload session',
  description: () => 'Start Claude again here, with new MCP servers and settings',
  available: (ctx) => ctx.folderExists,
  run: (ctx) => { surface(reloadSession(ctx.sessionId, null), 'Could not reload this session') },
}

export const PALETTE_ACTIONS: readonly PaletteAction[] = [ACCOUNT, RELOAD, OPEN_IN_VS_CODE]

/** The actions on offer for this chat that match what was typed, in registry order. */
export function paletteActionRows(registry: readonly PaletteAction[], query: string, ctx: PaletteContext): PaletteAction[] {
  const q = query.trim().toLowerCase()
  return registry.filter((a) => a.available(ctx)
    && (q === '' || fuzzyScore(q, a.label(ctx).toLowerCase()) !== null || a.description(ctx).toLowerCase().includes(q)))
}
