import type { ChatService } from '../../chat/chatService'
import { windowLifetimeWatcher } from '../../windows/windowAttachments'
import type { Handlers, Listeners } from '../registrar'

export interface ChatDeps {
  chat: ChatService
}

type HandledKeys = 'chatState' | 'chatStart' | 'chatSend' | 'chatInterrupt' | 'chatRespond'
  | 'chatSetPermissionMode' | 'chatSetModel' | 'chatSetEffort' | 'chatStop' | 'terminalBusy'
type ListenedKeys = 'chatAttach' | 'chatDetach'

/** Chat mode (`main/chat/`). Every argument has already passed the contract's guards. */
export function chatHandlers(deps: ChatDeps): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
} {
  const { chat } = deps
  /** A closed or reloaded window shows nothing any more; its renderer re-attaches as panes mount. */
  const watchLifetime = windowLifetimeWatcher((id) => { chat.detachWindow(id) })
  return {
    handlers: {
      chatState: (_e, sessionId) => chat.state(sessionId),
      chatStart: (_e, sessionId, opts) => chat.start(sessionId, opts),
      chatSend: (_e, sessionId, text) => { chat.send(sessionId, text) },
      chatInterrupt: (_e, sessionId) => { chat.interrupt(sessionId) },
      chatRespond: (_e, sessionId, requestId, decision) => { chat.respond(sessionId, requestId, decision) },
      chatSetPermissionMode: (_e, sessionId, mode) => { chat.setPermissionMode(sessionId, mode) },
      chatSetModel: (_e, sessionId, model) => { chat.setModel(sessionId, model) },
      chatSetEffort: (_e, sessionId, effort) => { chat.setEffort(sessionId, effort) },
      chatStop: (_e, sessionId) => chat.stop(sessionId),
      terminalBusy: (_e, sessionId) => chat.terminalBusy(sessionId),
    },
    listeners: {
      chatAttach: (e, sessionId) => {
        watchLifetime(e.sender)
        chat.attach(e.sender.id, sessionId)
      },
      chatDetach: (e, sessionId) => { chat.detach(e.sender.id, sessionId) },
    },
  }
}
