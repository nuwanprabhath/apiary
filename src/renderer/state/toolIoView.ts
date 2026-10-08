import { useCallback } from 'react'
import { createLocalStore } from './createLocalStore'
import { useAppSettings } from './settingsStore'

/**
 * Whether this window's chats hide their tool calls right now: the `hideToolCallIo` setting, unless
 * the "Hide tool calls" switch on the Chat tab has flipped it.
 *
 * The switch is the window's, not the user's. It is not saved: the setting is where "always" lives,
 * and a switch that rewrote it would make flipping the view for one long Bash log change every pane
 * and every window. It is a local store rather than the Chat tab's own state because only the
 * active tab's transcript is mounted, so switching tabs and back would otherwise undo it.
 *
 * It remembers which setting value it was flipped from. Once the setting changes, that flip no
 * longer applies and the new setting shows, so saving the Settings dialog always takes effect.
 */
interface Flip {
  hidden: boolean
  /** The setting's value when the switch was used; the flip counts only while it still holds. */
  from: boolean
}

const flipStore = createLocalStore<Flip | null>(null)

export interface ToolIoView {
  /** Tool calls are left out of the transcript. */
  hidden: boolean
  toggle: () => void
}

export function useToolIoHidden(): ToolIoView {
  const { hideToolCallIo: setting } = useAppSettings()
  const flipped = flipStore.useStore((flip) => (flip !== null && flip.from === setting ? flip.hidden : null))
  const hidden = flipped ?? setting
  const toggle = useCallback(() => { flipStore.set({ hidden: !hidden, from: setting }) }, [hidden, setting])
  return { hidden, toggle }
}
