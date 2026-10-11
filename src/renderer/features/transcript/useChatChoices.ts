import { useCallback, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import {
  isChatPermissionMode,
  type ChatEffort, type ChatPermissionMode, type ChatState,
} from '@shared/domain/chat'
import { setChatEffort, setChatModel, setChatPermissionMode } from '../../state/chatStore'

/** The mode the picker shows for what Claude reports — it calls Manual `default`. */
function shownMode(reported: string | null | undefined): ChatPermissionMode | '' {
  if (reported === 'default') return 'manual'
  return isChatPermissionMode(reported) ? reported : ''
}

export interface ChatChoices {
  /** Chosen before the chat has started: used when it starts. Once it runs, Claude's own report wins. */
  startMode: ChatPermissionMode | ''
  startModel: string
  startEffort: ChatEffort | null
  /** The permission mode the menu shows. */
  mode: ChatPermissionMode | ''
  chooseMode: (next: ChatPermissionMode) => void
  chooseChatModel: (next: string) => void
  chooseEffort: (next: ChatEffort) => void
}

/** Model, effort and permission mode for the chat: remembered for its start, or sent to it live. */
export function useChatChoices(chat: ChatState | null, chatRunning: boolean, sessionId: SessionId): ChatChoices {
  const [startMode, setStartMode] = useState<ChatPermissionMode | ''>('')
  const [startModel, setStartModel] = useState('default')
  const [startEffort, setStartEffort] = useState<ChatEffort | null>(null)
  const target = chat?.sessionId ?? sessionId

  const chooseMode = useCallback((next: ChatPermissionMode): void => {
    setStartMode(next)
    if (!chatRunning) return
    setChatPermissionMode(target, next)
  }, [chatRunning, target])

  const chooseChatModel = useCallback((next: string): void => {
    if (!chatRunning) { setStartModel(next); return }
    setChatModel(target, next)
  }, [chatRunning, target])

  const chooseEffort = useCallback((next: ChatEffort): void => {
    if (!chatRunning) { setStartEffort(next); return }
    setChatEffort(target, next)
  }, [chatRunning, target])

  const mode = chatRunning && chat !== null ? shownMode(chat.permissionMode) : startMode
  return { startMode, startModel, startEffort, mode, chooseMode, chooseChatModel, chooseEffort }
}
