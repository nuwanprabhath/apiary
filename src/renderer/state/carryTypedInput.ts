import type { PtyId } from '@shared/domain/ids'
import { mergeCarriedInput } from '@shared/typedInput'
import { createLocalStore } from './createLocalStore'
import { bestEffort } from './policy'
import { readDraft, writeDraft } from './uiState'

/**
 * Carrying what was typed in a terminal's Claude Code input box into the chat composer when a tab
 * switches from the Terminal view to the Chat view, so it need not be typed again. The terminal
 * keeps its text: nothing is typed into it, since every key that clears a box also interrupts a
 * running Claude.
 *
 * The composer stays mounted, hidden, behind the terminal, so the new draft is announced here as
 * well as saved; `seq` makes the same text carried twice a change.
 */
const carried = createLocalStore<{ sessionId: string; text: string; seq: number } | null>(null)

export async function carryTerminalInput(sessionId: string, ptyId: PtyId): Promise<void> {
  // Failing only leaves the composer as it was, which is what it shows anyway.
  const typed = await bestEffort(window.apiary.terminalTypedInput(ptyId), 'chat')
  if (typed === null) return
  const draft = readDraft(sessionId)
  const next = mergeCarriedInput(draft, typed)
  if (next === draft) return
  writeDraft(sessionId, next)
  carried.set((c) => ({ sessionId, text: next, seq: (c?.seq ?? 0) + 1 }))
}

/** The latest draft carried into `sessionId`'s composer, or null. */
export function useCarriedDraft(sessionId: string): { text: string; seq: number } | null {
  return carried.useStore((c) => (c?.sessionId === sessionId ? c : null))
}
