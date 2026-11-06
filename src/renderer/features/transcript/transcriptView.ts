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
  chatMode: boolean, chat: ChatState | null, messages: TranscriptMessage[], terminal: { running: boolean; busy: boolean },
) {
  if (!chatMode) return { tasks: [], turn: null, recap: null }
  const chatRunning = chat !== null && chat.status !== 'exited'
  const tasks = chatRunning && chat.backgroundTasks !== null
    ? withFileDetails(chat.backgroundTasks, runningBackgroundTasks(messages))
    : chatRunning || terminal.running ? runningBackgroundTasks(messages) : []
  // The working line says it instead, for a chat turn and for one in the session's terminal.
  if (chat?.status === 'busy' || (!chatRunning && terminal.busy)) return { tasks, turn: null, recap: null }
  const fromFile = latestTurn(messages)
  const live = chat === null ? null : turnOfChat(chat, chatRunning, messages)
  const turn = live !== null && (fromFile.endedAtMs === null || live.endedAt >= fromFile.endedAtMs)
    ? { durationMs: live.durationMs, endedAtMs: live.endedAt }
    : fromFile.durationMs !== null ? { durationMs: fromFile.durationMs, endedAtMs: fromFile.endedAtMs } : null
  return { tasks, turn, recap: fromFile.recap }
}

/**
 * A chat's own last turn, which the file may not record. A chat that has stopped keeps its state
 * while a window shows it; once the session has gone on in its terminal, the file's messages are
 * newer than that turn, and it is not the latest any more.
 */
function turnOfChat(chat: ChatState, running: boolean, messages: TranscriptMessage[]): ChatState['lastTurn'] {
  const turn = chat.lastTurn
  if (turn === null || running) return turn
  return messages.some((m) => m.timestampMs !== null && m.timestampMs > turn.endedAt) ? null : turn
}

interface ViewInput {
  sessionId: SessionId
  messages: TranscriptMessage[]
  showSidechain: boolean
  chatMode: boolean
  chat: ChatState | null
  terminalRunning: boolean
  /** Claude is mid-turn in the session's terminal. */
  terminalBusy: boolean
}

/** What the transcript draws, derived from the loaded messages and the chat's live part. */
export function useTranscriptView({ sessionId, messages, showSidechain, chatMode, chat, terminalRunning, terminalBusy }: ViewInput) {
  // Filtering on every render built a fresh array even when nothing about `messages` or
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
    () => chatStatusInfo(chatMode, chat, messages, { running: terminalRunning, busy: terminalBusy }),
    [chatMode, chat, messages, terminalRunning, terminalBusy],
  )
  return { visibleMessages, items, queued, status }
}
