import { lastPathSegment } from '@shared/text'
import { type JSX, useLayoutEffect, useMemo, useRef } from 'react'
import type { SessionId } from '@shared/domain/ids'
import { SESSION_LINK_PREFIX, type ResidentMessage, type ResidentStatus, type SessionHit } from '@shared/domain/residents'
import { useAppSettings } from '../../state/settingsStore'
import { treeStore } from '../../state/treeStore'
import { BusyGlyph } from '../../ui/BusyGlyph'
import { type LinkChips, MarkdownText } from '../../ui/message/MarkdownText'

const EXAMPLES = [
  'Open the session for !1175',
  'Where did we discuss the API interface design?',
  'What auth did we design between core and wildobs?',
]
const MAX_HITS = 3
/** How close to the bottom still counts as "at the bottom", so a stream keeps it there. */
const STICK_PX = 24

/** Why the index matched a session, in a word or two. */
function reasonTag(hit: SessionHit): string {
  switch (hit.reason) {
    case 'ref': return hit.snippet ?? 'linked'
    case 'topic': return hit.topic ?? 'topic'
    case 'text': return 'mentioned'
    case 'title': return 'name'
  }
}

function HitCards({ hits, onOpen }: { hits: readonly SessionHit[]; onOpen: (id: SessionId) => void }): JSX.Element {
  return (
    <div className="resident-hits">
      <span className="resident-hits-label">Possible matches</span>
      {hits.slice(0, MAX_HITS).map((hit) => (
        <button key={hit.sessionId} type="button" className="resident-hit" data-testid="resident-hit" onClick={() => { onOpen(hit.sessionId) }}>
          <span className="resident-hit-title">{hit.title}</span>
          {/* The folder's own name, as the sidebar shows it; the full path is the hover. */}
          <span className="resident-hit-where" title={hit.folder}>
            {hit.branch === null ? lastPathSegment(hit.folder) : `${lastPathSegment(hit.folder)} · ${hit.branch}`}
          </span>
          <span className="resident-hit-reason" title={reasonTag(hit)}>{reasonTag(hit)}</span>
        </button>
      ))}
    </div>
  )
}

function Message({ message, hits, chips, onOpen }: {
  message: ResidentMessage
  hits: readonly SessionHit[] | undefined
  chips: LinkChips
  onOpen: (id: SessionId) => void
}): JSX.Element | null {
  if (message.action === true) return <div className="resident-action" data-testid="resident-action">{message.text}</div>
  if (message.role === 'user') {
    return (
      <>
        <div className="resident-msg resident-msg-user">{message.text}</div>
        {hits !== undefined && hits.length > 0 && <HitCards hits={hits} onOpen={onOpen} />}
      </>
    )
  }
  if (message.text === '') return null
  return (
    <div className="resident-msg resident-msg-assistant">
      <MarkdownText text={message.text} chips={chips} />
    </div>
  )
}

/**
 * The last row while the resident works: the person's busy animation and what it is doing. It is
 * its own row, not part of a streaming answer, so a cycle Apiary started, a long shell command or
 * a helper still shows one.
 */
function WorkingLine({ resident }: { resident: ResidentStatus }): JSX.Element {
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  return (
    <div className="resident-streaming" data-testid="resident-working" role="status">
      <BusyGlyph animation={busyAnimation} color={busyAnimationColor} />
      <span className="resident-streaming-text">{resident.activity ?? 'Working…'}</span>
    </div>
  )
}

/**
 * The chat: the person's messages on the right, the resident's in markdown on the left with its
 * session links drawn as chips, and the instant matches under the message they answer. Sticks to
 * the bottom as an answer streams unless the person scrolled up.
 */
export function ResidentConversation({ resident, messages, hits, onOpen, onExample }: {
  resident: ResidentStatus
  messages: readonly ResidentMessage[]
  hits: ReadonlyMap<string, readonly SessionHit[]>
  onOpen: (id: SessionId) => void
  onExample: (text: string) => void
}): JSX.Element {
  const body = useRef<HTMLDivElement | null>(null)
  const atBottom = useRef(true)
  const working = resident.state === 'working'
  // What the person just asked for (a message, a quick action) brings the end into view even when they had scrolled up.
  const askedLast = messages.at(-1)?.role === 'user'
  useLayoutEffect(() => {
    if (askedLast) atBottom.current = true
    if (atBottom.current && body.current !== null) body.current.scrollTop = body.current.scrollHeight
  }, [messages, hits, working, askedLast])
  const chips = useMemo<LinkChips>(() => ({
    prefix: SESSION_LINK_PREFIX,
    className: 'resident-session-chip',
    testId: 'resident-session-chip',
    labelOf: (id) => treeStore.findSessionById(id)?.title ?? null,
    onOpen: (id) => { onOpen(id as SessionId) },
  }), [onOpen])
  return (
    <div
      ref={body}
      className="resident-popup-body"
      onScroll={(e) => {
        const el = e.currentTarget
        atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
      }}
    >
      {messages.length === 0 && !working
        ? (
          <div className="resident-empty">
            <p>Ask {resident.name} to find a session, or to answer from them.</p>
            {EXAMPLES.map((text) => (
              <button key={text} type="button" className="btn small resident-example" onClick={() => { onExample(text) }}>{text}</button>
            ))}
          </div>
        )
        : messages.map((m) => <Message key={m.id} message={m} hits={hits.get(m.id)} chips={chips} onOpen={onOpen} />)}
      {working && <WorkingLine resident={resident} />}
    </div>
  )
}
