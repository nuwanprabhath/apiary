import type { SessionId } from '@shared/domain/ids'
import type { TranscriptPage } from '@shared/domain/transcript'
import type { BackgroundTaskOutput } from '@shared/chatTimeline'
import type { TranscriptFindResult } from '@shared/ipc/contract'
import { bestEffort } from './policy'

/** A page of a session's transcript; the transcript view shows a failure inline. */
export const loadTranscript = (sessionId: SessionId, beforeIndex?: number): Promise<TranscriptPage> =>
  window.apiary.transcript(sessionId, beforeIndex)

/** What follows `afterIndex`: the newest page after a burst, or with `limit` the next page, for a view reading forward through history. */
export const loadTranscriptAfter = (sessionId: SessionId, afterIndex: number, limit?: boolean): Promise<TranscriptPage> =>
  window.apiary.transcriptAfter(sessionId, afterIndex, limit)
/** Line indexes of the messages that match `query`, newest first, searched by main over the file
 *  from `before` back; the find bar shows a failure as no results. */
export const findInTranscript = (sessionId: SessionId, query: string, before: number | null): Promise<TranscriptFindResult> =>
  window.apiary.transcriptFind(sessionId, query, before)

/** The end of a background task's output, for the task popup; a failed read is "not available"
 *  there, never a toast. */
export const loadTaskOutput = async (sessionId: SessionId, taskId: string): Promise<BackgroundTaskOutput> =>
  (await bestEffort(window.apiary.backgroundTaskOutput(sessionId, taskId), 'app')) ?? { available: false, lines: [] }

/** Stores a pasted image and answers its path; the composer says "Could not attach that image". */
export const saveImage = (base64: string, mediaType: string): Promise<string> => window.apiary.saveImage(base64, mediaType)

/** An image the transcript mentions, as a data URL; null when it is missing, unreadable or one
 *  Apiary will not serve (the caller shows the path as text instead). */
export const loadImage = (path: string): Promise<{ dataUrl: string } | null> =>
  bestEffort(window.apiary.readImage(path), 'app')
