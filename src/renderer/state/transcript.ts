import type { SessionId } from '@shared/domain/ids'
import type { TranscriptPage } from '@shared/domain/transcript'
import { bestEffort } from './policy'

/** A page of a session's transcript; the transcript view shows a failure inline. */
export const loadTranscript = (sessionId: SessionId, beforeIndex?: number): Promise<TranscriptPage> =>
  window.apiary.transcript(sessionId, beforeIndex)

/** Stores a pasted image and answers its path; the composer says "Could not attach that image". */
export const saveImage = (base64: string, mediaType: string): Promise<string> => window.apiary.saveImage(base64, mediaType)

/** An image the transcript mentions, as a data URL; null when it is missing, unreadable or one
 *  Apiary will not serve (the caller shows the path as text instead). */
export const loadImage = (path: string): Promise<{ dataUrl: string } | null> =>
  bestEffort(window.apiary.readImage(path), 'app')
