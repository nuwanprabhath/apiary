import { useCallback, useEffect, useState } from 'react'

/**
 * Settings the renderer itself acts on, read fresh from main rather than kept in sync with it.
 *
 * These change only when someone changes them, and only from the Settings dialog — there is no
 * other writer, and no push from main when they change elsewhere (there is nowhere else). So a
 * one-shot re-read on mount, plus `reload()` called when the dialog closes, is the whole of it;
 * a subscription would be solving a problem this state doesn't have. Ports App.tsx's five
 * `useState`s (287–305) and `loadUiSettings` verbatim.
 */
export interface AppSettingsMirror {
  revealActiveInSidebar: boolean
  recentSectionEnabled: boolean
  recentSectionHours: number
  searchChatContent: boolean
  searchSessionNotes: boolean
  /** Re-reads every field from main — call after the Settings dialog closes. */
  reload: () => void
}

export function useAppSettings(): AppSettingsMirror {
  const [revealActiveInSidebar, setRevealActiveInSidebar] = useState(true)
  const [recentSectionEnabled, setRecentSectionEnabled] = useState(true)
  const [recentSectionHours, setRecentSectionHours] = useState(24)
  const [searchChatContent, setSearchChatContent] = useState(true)
  const [searchSessionNotes, setSearchSessionNotes] = useState(true)

  const reload = useCallback(() => {
    void window.apiary.settingsGet()
      .then((s) => {
        setRevealActiveInSidebar(s.revealActiveInSidebar)
        setRecentSectionEnabled(s.recentSectionEnabled)
        setRecentSectionHours(s.recentSectionHours)
        setSearchChatContent(s.searchChatContent)
        setSearchSessionNotes(s.searchSessionNotes)
      })
      .catch(() => {
        // Defaults are already in place; a settings read failing is not worth interrupting anyone.
      })
  }, [])
  useEffect(() => { reload() }, [reload])

  return {
    revealActiveInSidebar, recentSectionEnabled, recentSectionHours,
    searchChatContent, searchSessionNotes, reload,
  }
}
