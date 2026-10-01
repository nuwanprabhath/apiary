import type { AppService } from '../../appService'
import type { Handlers } from '../registrar'

export interface ChatDeps {
  service: AppService
}

type HandledKeys = 'chatState' | 'chatStart' | 'chatSend' | 'chatInterrupt' | 'chatRespond'
  | 'chatSetPermissionMode' | 'chatSetModel' | 'chatSetEffort' | 'chatStop'

/** Chat mode (`main/chat/`). Every argument has already passed the contract's guards. */
export function chatHandlers(deps: ChatDeps): Pick<Handlers, HandledKeys> {
  const { service } = deps
  return {
    chatState: (_e, sessionId) => service.chatState(sessionId),
    chatStart: (_e, sessionId, opts) => service.chatStart(sessionId, opts),
    chatSend: (_e, sessionId, text) => { service.chatSend(sessionId, text) },
    chatInterrupt: (_e, sessionId) => { service.chatInterrupt(sessionId) },
    chatRespond: (_e, sessionId, requestId, decision) => { service.chatRespond(sessionId, requestId, decision) },
    chatSetPermissionMode: (_e, sessionId, mode) => { service.chatSetPermissionMode(sessionId, mode) },
    chatSetModel: (_e, sessionId, model) => { service.chatSetModel(sessionId, model) },
    chatSetEffort: (_e, sessionId, effort) => { service.chatSetEffort(sessionId, effort) },
    chatStop: (_e, sessionId) => service.chatStop(sessionId),
  }
}
