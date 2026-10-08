import { existsSync } from 'node:fs'
import { runningBackgroundTasks } from '@shared/chatTimeline'
import { latestAction } from '@shared/pets/actions'
import type { TranscriptPage } from '@shared/types'
import type { SessionStore } from '../store/sessionStore'
import type { TranscriptReader } from '../transcript/transcriptReader'
import type { SessionResolver } from './sessionResolver'

export interface TranscriptServiceDeps {
  resolver: SessionResolver
  store: SessionStore
  reader: TranscriptReader
}

/** How many sessions `latestActions` answers for at once, and how many messages it reads of each. */
const ACTION_KEYS = 8
const ACTION_TAIL = 12

/**
 * What the sessions' transcripts say, for the windows (the transcript pane, the pets) and for the
 * chat (`ChatService.terminalBusy`): every id goes through `SessionResolver.requireSession` first,
 * so the file read is one the store already knows about, never a path the renderer named.
 */
export class TranscriptService {
  constructor(private readonly deps: TranscriptServiceDeps) {}

  async page(sessionId: string, beforeIndex?: number): Promise<TranscriptPage> {
    const session = this.deps.resolver.requireSession(sessionId)
    // Claude's own session files can be deleted out from under Apiary — most often by removing
    // the git worktree the session ran in, which takes its whole `~/.claude/projects/<slug>`
    // directory with it. Saying so in one sentence is far more use than the raw
    // `ENOENT: no such file or directory, stat '/…'` this would otherwise reject with.
    if (!existsSync(session.filePath)) {
      throw new Error(
        `This session's transcript file is no longer on disk: ${session.filePath}. ` +
        'It was most likely deleted along with the folder it ran in. ' +
        'Remove the session from the sidebar to stop it being listed.',
      )
    }
    const page = await this.deps.reader.readTranscriptPage(session.filePath, { beforeIndex })
    if (session.messageCount === null) {
      const { messageCount } = await this.deps.reader.indexTranscript(session.filePath)
      this.deps.store.setMessageCount(sessionId, messageCount)
    }
    return page
  }

  /**
   * How many background tasks the session's `claude` has started that have not reported back, read
   * from its file; 0 when the file cannot be read (nothing to report is not an error here).
   */
  async runningBackgroundTasks(sessionId: string): Promise<number> {
    const session = this.deps.resolver.requireSession(sessionId)
    try {
      return runningBackgroundTasks((await this.deps.reader.readTranscriptPage(session.filePath)).messages).length
    } catch {
      return 0
    }
  }

  /**
   * What each of these sessions is doing, for the pets: the latest tool and its label, from the
   * end of its transcript (`latestAction` — never commands, output or conversation). Keys that
   * are not a known session (a new session's pty) are skipped; the paths are Apiary's own.
   */
  async latestActions(keys: string[]): Promise<{ key: string; action: string }[]> {
    const out: { key: string; action: string }[] = []
    for (const key of keys.slice(0, ACTION_KEYS)) {
      try {
        const session = this.deps.resolver.requireSession(key)
        const page = await this.deps.reader.readTranscriptPage(session.filePath, { limit: ACTION_TAIL })
        const action = latestAction(page.messages)
        if (action !== null) out.push({ key, action })
      // eslint-disable-next-line apiary/no-silent-catch -- not a session, or not readable: nothing to say about it
      } catch { /* skipped */ }
    }
    return out
  }
}
