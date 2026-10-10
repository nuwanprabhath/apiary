import { useCallback, useEffect } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { createLocalStore } from './createLocalStore'
import { loadChatSettings, saveChatSettings, subscribeChatSettings } from './uiState'

/**
 * The saved choices are the source of truth (`state/uiState.ts`, a key every window shares); this
 * store only counts changes so a reader re-renders when its window or another one saves.
 */
const changes = createLocalStore(0)

export interface UseChatSettings {
  /** The choices made in this chat, by setting id. A setting not listed follows its default. */
  values: Record<string, boolean>
  set: (settingId: string, value: boolean) => void
}

export function useChatSettings(sessionId: SessionId | null): UseChatSettings {
  changes.useStore()
  useEffect(() => subscribeChatSettings(() => { changes.set((n) => n + 1) }), [])
  const values = sessionId === null ? {} : loadChatSettings()[sessionId] ?? {}

  const set = useCallback((settingId: string, value: boolean) => {
    if (sessionId === null) return
    const all = loadChatSettings()
    saveChatSettings({ ...all, [sessionId]: { ...all[sessionId], [settingId]: value } })
    changes.set((n) => n + 1)
  }, [sessionId])

  return { values, set }
}
