import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { BackgroundTaskTally } from '@shared/chatTimeline'
import { latestAction } from '@shared/pets/actions'
import type { TranscriptPage } from '@shared/types'
import type { SessionStore, StoredSession } from '../store/sessionStore'
import type { forEachMessageFrom } from '../transcript/transcriptLines'
import type { TranscriptReader } from '../transcript/transcriptReader'

type TranscriptSession = Pick<StoredSession, 'filePath' | 'messageCount'>

export interface TranscriptServiceDeps {
  resolver: {
    requireSession(sessionId: string): TranscriptSession
    findSession(sessionId: string): TranscriptSession | null
  }
  store: Pick<SessionStore, 'setMessageCount'>
  reader: TranscriptReader
  readFrom: typeof forEachMessageFrom
}

/** The background tasks of one session, as its file reads up to `offset`. */
interface TaskRecord {
  offset: number
  tally: BackgroundTaskTally
  /** The last read queued for this session, so reads of one session run one after another. */
  queue: Promise<unknown>
}

/** How many sessions `latestActions` answers for at once, and how many messages it reads of each. */
const ACTION_KEYS = 8
const ACTION_TAIL = 12

/**
 * What the sessions' transcripts say, for the windows (the transcript pane, the pets) and for the
 * chat (`ChatService.terminalBusy`): every id goes through `SessionResolver` first (`requireSession`,
 * or `findSession` where an unknown id is nothing to do), so the file read is one the store already
 * knows about, never a path the renderer named.
 */
export class TranscriptService {
  /** Invalidated by a read that fails, and by the file shrinking below the offset already read. */
  private readonly taskRecords = new Map<string, TaskRecord>()

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
   * from its file; 0 when the file cannot be read (nothing to report is not an error here). Read
   * from where the last call stopped, since a long session is too big to re-read on every poll.
   */
  async runningBackgroundTasks(sessionId: string): Promise<number> {
    const session = this.deps.resolver.findSession(sessionId)
    if (session === null) return 0
    const record = this.taskRecords.get(sessionId) ?? { offset: 0, tally: new BackgroundTaskTally(), queue: Promise.resolve() }
    this.taskRecords.set(sessionId, record)
    const count = record.queue.then(() => this.readTasks(session.filePath, record))
    record.queue = count
    return count
  }

  private async readTasks(filePath: string, record: TaskRecord): Promise<number> {
    try {
      if ((await stat(filePath)).size < record.offset) resetTasks(record)
      const { tally } = record
      record.offset = await this.deps.readFrom(filePath, record.offset, (m) => tally.add([m]))
      return tally.tasks().length
    } catch {
      resetTasks(record)
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

function resetTasks(record: TaskRecord): void {
  record.offset = 0
  record.tally = new BackgroundTaskTally()
}
