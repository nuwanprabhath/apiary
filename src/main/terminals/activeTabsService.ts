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
  chats: Pick<ChatService, 'state'>
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
    if (tab.ptyId === null) return chatActivity(chats.state(asSessionId(tab.key)))
    const alive = pty.has(tab.ptyId)
    const status = classifyActivity(pty.screen(tab.ptyId), pty.lastOutputAt(tab.ptyId), now(), alive)
    if (status !== 'idle') return status
    return withBackgroundTasks(status, await transcripts.runningBackgroundTasks(tab.key))
  }
}
