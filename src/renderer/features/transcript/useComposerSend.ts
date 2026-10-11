import { ptyIdOfSession, type PtyId } from '@shared/domain/ids'
import { useCallback, useState } from 'react'
import type { ChatState } from '@shared/domain/chat'
import type { SessionNode } from '@shared/types'
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
}

/** Sends what is in the message box, or — `command`, from the "/" menu — just that command. */
export function useComposerSend(d: SendDeps): { sending: boolean, send: (command?: string) => Promise<void> } {
  const { notifyError } = useNotifications()
  const [sending, setSending] = useState(false)
  const { session, ptyId, running, onResume, onShowSession, chatMode, chat, chatRunning, choices, text, attachments, onSent } = d
  const { startModel, startMode, startEffort } = choices

  const send = useCallback(async (command?: string): Promise<void> => {
    const body = command ?? text.trim()
    const images = command === undefined ? attachments : []
    if (body === '' && images.length === 0) return
    setSending(true)
    try {
      // Claude reads an image from its path, so that is what the message carries. One per line,
      // under the prose, so the wording still reads as the sentence it was written as.
      const lines = [body, ...images.map((a) => a.path)].filter((l) => l !== '')
      if (chatMode) {
        // The chat takes the session over from its terminal if one is running: a session runs in
        // one place at a time (main stops the terminal's claude first), and the conversation
        // carries on from the same file. Nothing switches views — the reply streams in above.
        //
        // Never at a cost, though. A terminal mid-turn, or with background tasks still running
        // (its children: they die with it), keeps the session — the message is typed into it, and
        // the transcript, which reads the same file, shows it arrive. Claude Code queues a message
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
          await startChat(sessionId, {
            takeOver: true,
            ...(startModel !== 'default' ? { model: startModel } : {}),
            ...(startMode !== '' ? { permissionMode: startMode } : {}),
            ...(startEffort !== null ? { effort: startEffort } : {}),
          })
        }
        await sendChat(sessionId, lines.join('\n'))
        if (command === undefined) onSent()
        return
      }
      let target: PtyId | null = ptyId
      if (!running || target === null) {
        // Resuming is what makes there be anything to type into. Doing it here rather than making
        // the user find the Resume button first is the whole point of a chat box.
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
  }, [text, attachments, ptyId, running, onResume, onShowSession, session.sessionId, notifyError, chatMode, chatRunning, chat?.sessionId, startModel, startMode, startEffort, onSent])

  return { sending, send }
}
