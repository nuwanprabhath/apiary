import { type JSX, type KeyboardEvent, type MouseEvent, type ReactNode, createContext, use, useMemo } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { MentionContext } from '@shared/mentions/kinds'
import type { RepoWebLocation } from '@shared/mentions/repoWebLocation'
import { openMentionedFile } from '../../state/sessions'
import { openReferenceLink, useRepoWebLocation } from '../../state/mentions'
import { useVsCodeAvailable } from '../../state/vsCodeStore'
import { mentionOf, refLinkOf } from './mentionMarkup'

export interface Mentions extends MentionContext {
  /** Which session's folder a mentioned file is looked for in; null where files are never linked. */
  sessionId: SessionId | null
}

const MentionsContext = createContext<Mentions | null>(null)

/**
 * Makes the mentions in the transcript text below it clickable: file names when VS Code is
 * available (main decides what file a click means), and references such as `#12` and `!34` when
 * main knows the session's repository on GitHub or GitLab.
 */
export function FileMentionsProvider({ sessionId, children }: { sessionId: SessionId; children: ReactNode }): JSX.Element {
  const files = useVsCodeAvailable()
  const repo = useRepoWebLocation(sessionId)
  const value = useMemo(() => ({ sessionId, files, repo }), [files, repo, sessionId])
  return <MentionsContext value={value}>{children}</MentionsContext>
}

/** References in the text below resolve against `repo` (a resident's configured project); no files. */
export function RepoMentionsProvider({ repo, children }: { repo: RepoWebLocation | null; children: ReactNode }): JSX.Element {
  const value = useMemo(() => ({ sessionId: null, files: false, repo }), [repo])
  return <MentionsContext value={value}>{children}</MentionsContext>
}

/** What the text below may link, or null outside any provider, where it stays plain. */
export function useFileMentions(): Mentions | null {
  const value = use(MentionsContext)
  return value === null || (!value.files && value.repo === null) ? null : value
}

/** Click and Enter/Space handlers for a block of markdown whose mentions were marked. */
export function mentionHandlers(mentions: Mentions | null): {
  onClick?: (e: MouseEvent<HTMLElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void
} {
  if (mentions === null) return {}
  const open = (target: EventTarget, prevent: () => void): void => {
    const el = target instanceof Element ? target : null
    const href = refLinkOf(el)
    if (href !== null) {
      prevent()
      openReferenceLink(href)
      return
    }
    const mention = mentionOf(el)
    if (mention === null || mentions.sessionId === null) return
    prevent()
    openMentionedFile(mentions.sessionId, mention)
  }
  return {
    onClick: (e) => { open(e.target, () => { e.preventDefault() }) },
    onKeyDown: (e) => {
      // Enter on a real link is already a click; Enter and Space are for file mentions.
      if ((e.key === 'Enter' || e.key === ' ') && refLinkOf(e.target instanceof Element ? e.target : null) === null) {
        open(e.target, () => { e.preventDefault() })
      }
    },
  }
}
