import { type JSX, type KeyboardEvent, type MouseEvent, type ReactNode, createContext, use, useMemo } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { openMentionedFile } from '../../state/sessions'
import { useVsCodeAvailable } from '../../state/vsCodeStore'
import { mentionOf } from './mentionMarkup'

interface Mentions {
  /** Which session's folder a mentioned file is looked for in. */
  sessionId: SessionId
}

const MentionsContext = createContext<Mentions | null>(null)

/**
 * Makes the file names in the transcript text below it clickable, when VS Code is available: the
 * click sends the session id and the text as written, and main decides what file that is (or none).
 */
export function FileMentionsProvider({ sessionId, children }: { sessionId: SessionId; children: ReactNode }): JSX.Element {
  const available = useVsCodeAvailable()
  const value = useMemo(() => (available ? { sessionId } : null), [available, sessionId])
  return <MentionsContext value={value}>{children}</MentionsContext>
}

/** The session whose files may be linked, or null when VS Code is missing and the text stays plain. */
export function useFileMentions(): Mentions | null {
  return use(MentionsContext)
}

/** Click and Enter/Space handlers for a block of markdown whose mentions were marked. */
export function mentionHandlers(mentions: Mentions | null): {
  onClick?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
} {
  if (mentions === null) return {}
  const open = (target: EventTarget, prevent: () => void): boolean => {
    const mention = target instanceof Element ? mentionOf(target) : null
    if (mention === null) return false
    prevent()
    openMentionedFile(mentions.sessionId, mention)
    return true
  }
  return {
    onClick: (e) => { open(e.target, () => { e.preventDefault() }) },
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e.target, () => { e.preventDefault() })
    },
  }
}
