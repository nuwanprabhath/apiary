import { chatActivity, classifyActivity, withBackgroundTasks, type ActivityStatus } from '@shared/activity'
import { asSessionId } from '@shared/domain/ids'
import type { ActiveTabPayload, OpenTab } from '@shared/domain/tabs'
import type { ChatService } from '../chat/chatService'
import type { PtyManager } from '../pty/ptyManager'
import type { TranscriptService } from '../sessions/transcriptService'
import type { TabRegistry } from '../windows/tabRegistry'

export interface ActiveTabsDeps {
  tabs: Pick<TabRegistry, 'list'>
  pty: Pick<PtyManager, 'has' | 'screen' | 'lastOutputAt'>
  chats: Pick<ChatService, 'state' | 'terminalsOf'>
  transcripts: Pick<TranscriptService, 'runningBackgroundTasks'>
  now: () => number
}

/**
 * What each open tab is doing, for the Active section. A terminal's activity is read from its
 * rendered screen and a chat's from its state; background tasks keep a session running with nothing
 * on the screen, so an idle terminal asks its session file and an idle chat already knows.
 */
export class ActiveTabsService {
  constructor(private readonly deps: ActiveTabsDeps) {}

  async list(): Promise<ActiveTabPayload[]> {
    return Promise.all(this.deps.tabs.list().map(async (tab) => ({
      windowNumber: tab.windowNumber,
      key: tab.key,
      view: tab.view,
      label: tab.label,
      status: await this.statusOf(tab),
    })))
  }

  private async statusOf(tab: OpenTab): Promise<ActivityStatus> {
    const { pty, chats, transcripts, now } = this.deps
    const ptyId = tab.ptyId ?? this.liveTerminalOf(tab.key)
    if (ptyId === null) return chatActivity(chats.state(asSessionId(tab.key)))
    const alive = pty.has(ptyId)
    const status = classifyActivity(pty.screen(ptyId), pty.lastOutputAt(ptyId), now(), alive)
    if (status !== 'idle') return status
    return withBackgroundTasks(status, await transcripts.runningBackgroundTasks(tab.key))
  }

  /**
   * A tab whose window reports no pty (shown as a chat, or resumed from another window) still has
   * its claude in a terminal until a chat takes the session over: that terminal speaks for it, as it
   * does for `ChatService.terminalBusy`. A running chat owns the session.
   */
  private liveTerminalOf(key: string): string | null {
    const { chats, pty } = this.deps
    const chat = chats.state(asSessionId(key))
    if (chat !== null && chat.status !== 'exited') return null
    return chats.terminalsOf(asSessionId(key)).find((id) => pty.has(id)) ?? null
  }
}
