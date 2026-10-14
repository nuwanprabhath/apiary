import { useMemo } from 'react'
import type { TranscriptMessage } from '@shared/types'
import type { ChatState } from '@shared/domain/chat'
import type { SessionId } from '@shared/domain/ids'
import { chatItems, latestTurn, mergeLive, runningBackgroundTasks, stillQueued, withFileDetails, withoutToolCalls } from '@shared/chatTimeline'
import { useLibraryState } from '../../state/libraryStateStore'
import { useChatSettings } from '../../state/chatSettingsStore'
import { SHOW_TOOL_CALLS, chatSettingValue } from '../../state/chatSettings'

/** The line above the message box: background tasks still running (claude's own list while it
 *  runs as a chat, else the file's, while its terminal runs), and how the latest turn ended. */
function chatStatusInfo(
  chatMode: boolean, chat: ChatState | null, messages: TranscriptMessage[], terminalRunning: boolean,
) {
  if (!chatMode) return { tasks: [], turn: null, recap: null }
  const chatRunning = chat !== null && chat.status !== 'exited'
  const tasks = chatRunning && chat.backgroundTasks !== null
    ? withFileDetails(chat.backgroundTasks, runningBackgroundTasks(messages))
    : chatRunning || terminalRunning ? runningBackgroundTasks(messages) : []
  if (chat?.status === 'busy') return { tasks, turn: null, recap: null }
  const fromFile = latestTurn(messages)
  const live = chat?.lastTurn ?? null
  const turn = live !== null && (fromFile.endedAtMs === null || live.endedAt >= fromFile.endedAtMs)
    ? { durationMs: live.durationMs, endedAtMs: live.endedAt }
    : fromFile.durationMs !== null ? { durationMs: fromFile.durationMs, endedAtMs: fromFile.endedAtMs } : null
  return { tasks, turn, recap: fromFile.recap }
}

interface ViewInput {
  sessionId: SessionId
  messages: TranscriptMessage[]
  showSidechain: boolean
  chatMode: boolean
  chat: ChatState | null
  terminalRunning: boolean
}

/** What the transcript draws, derived from the loaded messages and the chat's live part. */
export function useTranscriptView({ sessionId, messages, showSidechain, chatMode, chat, terminalRunning }: ViewInput) {
  // UI-8: filtering on every render built a fresh array even when nothing about `messages` or
  // `showSidechain` had changed — cheap for one render, but this list only grows, and a filter
  // over the whole thing ran on every unrelated re-render of `Transcript` too.
  const { hideToolCallIo: globalHideToolCalls } = useLibraryState()
  const { values: perChatSettings } = useChatSettings(sessionId)
  const hideToolCalls = !chatSettingValue(SHOW_TOOL_CALLS, perChatSettings, { hideToolCallIo: globalHideToolCalls })
  const visibleMessages = useMemo(() => {
    const shown = showSidechain ? messages : messages.filter((m) => !m.isSidechain)
    return hideToolCalls ? withoutToolCalls(shown) : shown
  }, [messages, showSidechain, hideToolCalls])

  // Chat view: the file's messages plus whatever the chat has streamed that the file has not caught
  // up with yet (matched by uuid, so nothing shows twice).
  const items = useMemo(() => {
    if (!chatMode) return []
    const live = (chat?.live ?? []).filter((m) => showSidechain || !m.isSidechain)
    return chatItems(mergeLive(visibleMessages, hideToolCalls ? withoutToolCalls(live) : live))
  }, [chatMode, chat?.live, visibleMessages, showSidechain, hideToolCalls])
  const queued = useMemo(() => stillQueued(chat?.queued ?? [], messages), [chat?.queued, messages])
  const status = useMemo(
    () => chatStatusInfo(chatMode, chat, messages, terminalRunning),
    [chatMode, chat, messages, terminalRunning],
  )
  return { visibleMessages, items, queued, status }
}
