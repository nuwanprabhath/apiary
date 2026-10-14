import type { JSX } from 'react'
import type { BackgroundTask } from '@shared/chatTimeline'
import type { SessionId } from '@shared/domain/ids'
import { formatDuration } from '@shared/time'
import { BackgroundTasksLine } from './BackgroundTasks'

/** The past tense Claude Code's terminal picks for a finished turn ("✻ Brewed for 33s"). */
const DONE_VERBS = ['Brewed', 'Baked', 'Churned', 'Cogitated', 'Cooked', 'Crunched', 'Mulled', 'Percolated', 'Simmered', 'Worked']

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

export interface ChatStatusInfo {
  /** Background tasks still running; empty for none. */
  tasks: BackgroundTask[]
  /** The latest finished turn — shown only while Claude is not working on another. */
  turn: { durationMs: number; endedAtMs: number | null } | null
  /** The recap Claude Code wrote since that turn, if any. */
  recap: string | null
}

/**
 * The lines between the conversation and the message box, as Claude Code's terminal prints them
 * under its last reply: background tasks still running ("1 shell"), how long the last turn took
 * and when it finished, and the recap it writes when you come back. Nothing when there is nothing
 * to say.
 */
export function ChatStatus({ sessionId, tasks, turn, recap }: ChatStatusInfo & { sessionId: SessionId }): JSX.Element | null {
  if (tasks.length === 0 && turn === null && recap === null) return null
  const verb = turn !== null ? DONE_VERBS[Math.floor((turn.endedAtMs ?? turn.durationMs) / 1000) % DONE_VERBS.length] : ''
  return (
    <div className="chat-status" data-testid="chat-status">
      {turn !== null && (
        <div className="chat-status-line" data-testid="chat-status-turn">
          <span className="chat-status-glyph" aria-hidden="true">✻</span>
          {verb} for {formatDuration(turn.durationMs)}
          {turn.endedAtMs !== null && <> · done {clock(turn.endedAtMs)}</>}
        </div>
      )}
      {recap !== null && (
        <div className="chat-status-line chat-status-recap" data-testid="chat-status-recap">
          <span className="chat-status-glyph" aria-hidden="true">※</span>
          <span><strong>recap:</strong> {recap}</span>
        </div>
      )}
      {tasks.length > 0 && <BackgroundTasksLine sessionId={sessionId} tasks={tasks} />}
    </div>
  )
}
