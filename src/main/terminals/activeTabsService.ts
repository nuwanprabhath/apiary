import { chatActivity, explainActivity, withBackgroundTasks, type ActivityStatus } from '@shared/activity'
import { asSessionId } from '@shared/domain/ids'
import { readTerminalNotice } from '@shared/terminalNotice'
import type { ActiveTabPayload, OpenTab } from '@shared/domain/tabs'
import type { ChatService } from '../chat/chatService'
import { log } from '../log/logger'
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
  /** Each terminal tab's last status, so the log says once why it turned running or waiting. Invalidated by
   *  `list`: a tab no longer listed is dropped. */
  private readonly lastStatus = new Map<string, ActivityStatus>()

  constructor(private readonly deps: ActiveTabsDeps) {}

  async list(): Promise<ActiveTabPayload[]> {
    const tabs = this.deps.tabs.list()
    const listed = new Set(tabs.map((tab) => tab.key))
    for (const key of this.lastStatus.keys()) if (!listed.has(key)) this.lastStatus.delete(key)
    return Promise.all(tabs.map(async (tab) => {
      const notice = tab.ptyId === null ? null : readTerminalNotice(this.deps.pty.screen(tab.ptyId))
      return {
        windowNumber: tab.windowNumber,
        key: tab.key,
        view: tab.view,
        label: tab.label,
        status: await this.statusOf(tab),
        ...(notice === null ? {} : { notice }),
      }
    }))
  }

  private async statusOf(tab: OpenTab): Promise<ActivityStatus> {
    const { pty, chats, transcripts, now } = this.deps
    if (tab.ptyId === null) return chatActivity(chats.state(asSessionId(tab.key)))
    const alive = pty.has(tab.ptyId)
    const at = now()
    const lastOutputAt = pty.lastOutputAt(tab.ptyId)
    const why = explainActivity(pty.screen(tab.ptyId), lastOutputAt, at, alive)
    const tasks = why.status === 'idle' ? await transcripts.runningBackgroundTasks(tab.key) : 0
    const status = withBackgroundTasks(why.status, tasks)
    if ((status === 'running' || status === 'waiting') && this.lastStatus.get(tab.key) !== status) {
      // Which rule said so, never what the screen says: the log carries no conversation.
      log.info('activity', `terminal tab is ${status}`, {
        ptyId: tab.ptyId, rule: tasks > 0 ? 'background-tasks' : why.rule, line: why.line, tasks, msSinceOutput: at - lastOutputAt,
      })
    }
    this.lastStatus.set(tab.key, status)
    return status
  }
}
