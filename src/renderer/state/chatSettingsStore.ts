import { useCallback } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { updateLibraryState, useLibraryState } from './libraryStateStore'

/**
 * Each chat's own settings are library state (`chatSettings` in `shared/libraryState.ts`): they say
 * how this machine's chat is read, so a remote window reads and writes the work machine's.
 */
export interface UseChatSettings {
  /** The choices made in this chat, by setting id. A setting not listed follows its default. */
  values: Record<string, boolean>
  set: (settingId: string, value: boolean) => void
}

const NONE: Record<string, boolean> = {}

export function useChatSettings(sessionId: SessionId | null): UseChatSettings {
  const { chatSettings } = useLibraryState()
  const values = sessionId === null ? NONE : chatSettings[sessionId] ?? NONE

  const set = useCallback((settingId: string, value: boolean) => {
    if (sessionId === null) return
    updateLibraryState(({ chatSettings: all }) => ({ chatSettings: { ...all, [sessionId]: { ...all[sessionId], [settingId]: value } } }))
  }, [sessionId])

  return { values, set }
}
