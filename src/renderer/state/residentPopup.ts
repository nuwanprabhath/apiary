import { createLocalStore } from './createLocalStore'

/**
 * Which resident's chat popup this window shows, and a question waiting to be sent from it.
 * Per window (a `createLocalStore`): the popup belongs to the window it was summoned in, while the
 * history it shows comes from main and is the same everywhere (`residentChat.ts`).
 */
export interface ResidentPopupState {
  /** The resident whose popup is open, or null. */
  openId: string | null
  /** A question handed over to be sent as the popup opens (the search box's ⌘↵), taken once. */
  ask: { residentId: string; text: string } | null
}

const popup = createLocalStore<ResidentPopupState>({ openId: null, ask: null })

/** The popup state, for the status bar's badge and the popup itself. */
export function useResidentPopup(): ResidentPopupState {
  return popup.useStore()
}

/** Opens the resident's popup; with `ask`, the popup sends it as soon as it is showing. */
export function openResidentPopup(residentId: string, ask?: string): void {
  const text = ask?.trim() ?? ''
  popup.set({ openId: residentId, ask: text === '' ? null : { residentId, text } })
}

/** Opens the resident's popup, or closes it when it is the one open (the badge's click, ⌘⇧Space). */
export function toggleResidentPopup(residentId: string): void {
  popup.set((cur) => (cur.openId === residentId ? { openId: null, ask: null } : { openId: residentId, ask: null }))
}

/** Closes the popup (its X button: nothing else closes it). */
export function closeResidentPopup(): void {
  popup.set({ openId: null, ask: null })
}

/** The question waiting for this resident, removed as it is read so it is sent once. */
export function takeResidentAsk(residentId: string): string | null {
  const { ask } = popup.get()
  if (ask === null || ask.residentId !== residentId) return null
  popup.set((cur) => ({ ...cur, ask: null }))
  return ask.text
}
