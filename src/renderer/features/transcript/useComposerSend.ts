import { askAside, asideQuestion, openAside } from '../../state/chatAside'
import { isMcpCommand, openMcp } from '../../state/chatMcp'
import { ptyIdOfSession, type PtyId } from '@shared/domain/ids'
import { useCallback, useState } from 'react'
import type { ChatState } from '@shared/domain/chat'
import type { NewSessionInfo, SessionNode } from '@shared/types'
import { isLoginCommand, startSessionLogin } from '../../state/accountsStore'
import { useNotifications } from '../../ui/notifications'
import { sendChat, startChat, terminalBusy } from '../../state/chatStore'
import { sendPrompt } from '../../state/terminals'
import type { Attachment } from './composerAttachments'
import type { ChatChoices } from './useChatChoices'

interface SendDeps {
  session: SessionNode
  ptyId: PtyId | null
  running: boolean
  onResume: () => Promise<void>
  onShowSession: () => void
  chatMode: boolean
  chat: ChatState | null
  chatRunning: boolean
  choices: ChatChoices
  text: string
  attachments: Attachment[]
  /** The message went: empty the box and the attachments. */
  onSent: () => void
  /** Opens the terminal `/login` starts as a tab; without it, `/login` goes to Claude as any message. */
  onSessionStarted?: (info: NewSessionInfo) => void
}

const TERMINAL_KEEPS_IT = 'Claude is working in this session’s terminal, so the servers are the terminal’s until it finishes. Type /mcp in the terminal, or open this again once Claude is idle.'

/** How a chat starts from the message box: taking over an idle terminal, with what the box has picked. */
function startOptions({ startModel, startMode, startEffort }: ChatChoices): Parameters<typeof startChat>[1] {
  return {
    takeOver: true,
    ...(startModel !== 'default' ? { model: startModel } : {}),
    ...(startMode !== '' ? { permissionMode: startMode } : {}),
    ...(startEffort !== null ? { effort: startEffort } : {}),
  }
}

/** Sends what is in the message box, or — `command`, from the "/" menu — just that command. */
export function useComposerSend(d: SendDeps): { sending: boolean, send: (command?: string) => Promise<void> } {
  const { notifyError } = useNotifications()
  const [sending, setSending] = useState(false)
  const { session, ptyId, running, onResume, onShowSession, chatMode, chat, chatRunning, choices, text, attachments, onSent, onSessionStarted } = d

  const send = useCallback(async (command?: string): Promise<void> => {
    const body = command ?? text.trim()
    const images = command === undefined ? attachments : []
    if (body === '' && images.length === 0) return
    setSending(true)
    try {
      // Claude reads an image from its path, so that is what the message carries, one per line under the prose.
      const lines = [body, ...images.map((a) => a.path)].filter((l) => l !== '')
      if (chatMode) {
        // `/btw <question>`: a side question, answered apart from the conversation. Nothing is sent
        // to the chat, so it can be asked mid-turn and starts or takes over nothing. (A terminal
        // has Claude Code's own `/btw`; there the message goes to it, below.)
        // `/btw` alone opens the thread as it was left, to carry on with it.
        const aside = asideQuestion(body)
        if (aside !== null) {
          const asideSession = chat?.sessionId ?? session.sessionId
          if (aside === '') openAside(asideSession)
          else askAside(asideSession, aside)
          if (command === undefined) onSent()
          return
        }
        // `/login`: Claude Code's own is not available in stream-json mode ("isn't available in this
        // environment"), so it opens a terminal under the session's account that runs it there. The
        // sign-in link in it opens in this machine's browser, a remote window's too.
        if (isLoginCommand(body) && onSessionStarted !== undefined) {
          const info = await startSessionLogin(chat?.sessionId ?? session.sessionId)
          onSessionStarted(info)
          if (command === undefined) onSent()
          return
        }
        // `/mcp`: the card that reads and drives the chat's MCP servers, as the terminal's `/mcp`
        // dialog does. It needs a chat to ask, which it starts as a message would.
        if (isMcpCommand(body)) {
          const mcpSession = chat?.sessionId ?? session.sessionId
          void openMcp(mcpSession, async () => {
            if (chatRunning) return null
            if (running && ptyId !== null) {
              const terminal = await terminalBusy(session.sessionId)
              if (terminal.busy || terminal.backgroundTasks > 0) return TERMINAL_KEEPS_IT
            }
            await startChat(mcpSession, startOptions(choices))
            return null
          })
          if (command === undefined) onSent()
          return
        }
        // The chat takes the session over from its terminal if one is running: a session runs in
        // one place at a time (main stops the terminal's claude first), on the same file.
        //
        // Not when the terminal is mid-turn or has background tasks running (they die with it):
        // it keeps the session and the message is typed into it. Claude Code queues a message
        // typed while it works, as the chat does.
        const sessionId = chat?.sessionId ?? session.sessionId
        if (!chatRunning && running && ptyId !== null) {
          const terminal = await terminalBusy(session.sessionId)
          if (terminal.busy || terminal.backgroundTasks > 0) {
            await sendPrompt(ptyId, lines.join('\n'))
            if (command === undefined) onSent()
            return
          }
        }
        if (!chatRunning) {
          await startChat(sessionId, startOptions(choices))
        }
        await sendChat(sessionId, lines.join('\n'))
        if (command === undefined) onSent()
        return
      }
      let target: PtyId | null = ptyId
      if (!running || target === null) {
        // Resuming is what makes there be anything to type into.
        await onResume()
        target = ptyIdOfSession(session.sessionId)
      }
      await sendPrompt(target, lines.join('\n'))
      onSent()
      onShowSession()
    } catch (e) {
      notifyError(e, 'Could not send that message')
    } finally {
      setSending(false)
    }
  }, [text, attachments, ptyId, running, onResume, onShowSession, session.sessionId, notifyError, chatMode, chatRunning, chat?.sessionId, choices, onSent, onSessionStarted])

  return { sending, send }
}
