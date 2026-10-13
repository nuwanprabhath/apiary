import type { SessionId } from '@shared/domain/ids'
import { fuzzyScore } from '@shared/fuzzy'
import { openSessionInVsCode } from '../../state/sessions'

/** What decides whether an action is offered for this chat. */
export interface PaletteContext {
  sessionId: SessionId
  vsCodeAvailable: boolean
  /** The session's folder is still on disk. */
  folderExists: boolean
}

/** One entry of the "/" menu's Actions group. The next action is one more entry in `PALETTE_ACTIONS`. */
export interface PaletteAction {
  id: string
  label: string
  description: string
  /** Absent from the menu, not disabled, when false. */
  available: (ctx: PaletteContext) => boolean
  run: (ctx: PaletteContext) => void
}

const OPEN_IN_VS_CODE: PaletteAction = {
  id: 'open-in-vscode',
  label: 'Open in VS Code',
  description: 'This session’s folder',
  // The sidebar row's VS Code button has the same condition.
  available: (ctx) => ctx.vsCodeAvailable && ctx.folderExists,
  run: (ctx) => { openSessionInVsCode(ctx.sessionId) },
}

export const PALETTE_ACTIONS: readonly PaletteAction[] = [OPEN_IN_VS_CODE]

/** The actions on offer for this chat that match what was typed, in registry order. */
export function paletteActionRows(registry: readonly PaletteAction[], query: string, ctx: PaletteContext): PaletteAction[] {
  const q = query.trim().toLowerCase()
  return registry.filter((a) => a.available(ctx)
    && (q === '' || fuzzyScore(q, a.label.toLowerCase()) !== null || a.description.toLowerCase().includes(q)))
}
