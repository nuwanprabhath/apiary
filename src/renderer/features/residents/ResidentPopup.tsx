import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { ResidentStatus, SessionHit } from '@shared/domain/residents'
import { useResident } from '../../state/residentsStore'
import { clearResident, markResidentSeen, sendToResident, stopResident, useResidentHistory } from '../../state/residentChat'
import { closeResidentPopup, takeResidentAsk, useResidentPopup } from '../../state/residentPopup'
import { readResidentDraft } from '../../state/uiState'
import { describeError } from '../../ui/errors'
import { FloatingPanel } from '../../ui/FloatingPanel'
import { CloseIcon, TrashIcon } from '../../ui/icons'
import { StopIcon } from '../../ui/icons/StopIcon'
import { useOpenSession } from '../workspace'
import { ResidentOrb } from './ResidentBadge'
import { ResidentComposer } from './ResidentComposer'
import { ResidentConversation } from './ResidentConversation'
import { PermissionCards, SetupBanner } from './ResidentRequests'
import { usePopupRect } from './usePopupRect'

const CONFIRM_MS = 4000

/** Clear history: the trash, then an inline "Clear?" that asks for Yes for four seconds. */
function ClearButton({ residentId }: { residentId: string }): JSX.Element {
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const timer = window.setTimeout(() => { setAsking(false) }, CONFIRM_MS)
    return () => { window.clearTimeout(timer) }
  }, [asking])
  if (!asking) {
    return (
      <button type="button" className="resident-icon-btn" title="Clear history" aria-label="Clear history" onClick={() => { setAsking(true) }}>
        <TrashIcon />
      </button>
    )
  }
  return (
    <span className="resident-confirm">
      Clear?
      <button type="button" className="btn small danger" onClick={() => { setAsking(false); clearResident(residentId) }}>Yes</button>
      <button type="button" className="btn small" onClick={() => { setAsking(false) }}>No</button>
    </span>
  )
}

function Header({ resident, onPointerDown }: { resident: ResidentStatus; onPointerDown: (e: React.PointerEvent<HTMLElement>) => void }): JSX.Element {
  const doing = resident.state === 'working' ? (resident.activity ?? 'Working…') : resident.state
  return (
    <div
      className="resident-popup-header"
      onPointerDown={(e) => { if (!(e.target instanceof Element && e.target.closest('button') !== null)) onPointerDown(e) }}
    >
      <ResidentOrb state={resident.state} appearance={resident.appearance} small />
      <span className="resident-popup-title">
        <strong>{resident.name}</strong>
        <span className="resident-popup-doing" title={doing}>{doing}</span>
      </span>
      {resident.state === 'working' && (
        <button type="button" className="resident-icon-btn" data-testid="resident-popup-stop" title="Stop" aria-label={`Stop ${resident.name}`} onClick={() => { stopResident(resident.id) }}>
          <StopIcon />
        </button>
      )}
      <ClearButton residentId={resident.id} />
      <button type="button" className="resident-icon-btn" data-testid="resident-popup-close" title="Close" aria-label="Close" onClick={closeResidentPopup}>
        <CloseIcon />
      </button>
    </div>
  )
}

/** Instant matches by the user message they belong to: a send's answer is attached to the message main echoes back. */
function useHits(messages: ReturnType<typeof useResidentHistory>): {
  hits: ReadonlyMap<string, readonly SessionHit[]>
  expect: (text: string, hits: SessionHit[]) => void
} {
  const [hits, setHits] = useState<ReadonlyMap<string, readonly SessionHit[]>>(() => new Map())
  const [pending, setPending] = useState<{ text: string; hits: SessionHit[] } | null>(null)
  useEffect(() => {
    if (pending === null) return
    const mine = [...messages].reverse().find((m) => m.role === 'user' && m.text === pending.text && !hits.has(m.id))
    if (mine === undefined) return
    setHits((cur) => new Map(cur).set(mine.id, pending.hits))
    setPending(null)
  }, [messages, pending, hits])
  return { hits, expect: useCallback((text, found) => { setPending({ text, hits: found }) }, []) }
}

function Panel({ resident, onOpenSettings }: { resident: ResidentStatus; onOpenSettings: (section: string) => void }): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null)
  const { rect, handle } = usePopupRect(panel)
  const messages = useResidentHistory(resident.id)
  const openSession = useOpenSession()
  const { hits, expect } = useHits(messages)
  const [draft, setDraft] = useState(() => readResidentDraft(resident.id))
  const [error, setError] = useState<string | null>(null)
  const send = useCallback((text: string) => {
    setError(null)
    sendToResident(resident.id, text).then((found) => { expect(text, found) }, (e: unknown) => { setError(describeError(e).message) })
  }, [resident.id, expect])
  const { ask } = useResidentPopup()
  useEffect(() => {
    const text = takeResidentAsk(resident.id)
    if (text !== null) send(text)
  }, [ask, resident.id, send])
  // Showing the popup is seeing what it flagged; permission requests stay until answered.
  const flagged = resident.attention !== null
  useEffect(() => {
    if (flagged) markResidentSeen(resident.id)
  }, [flagged, resident.id])

  return (
    <FloatingPanel
      ref={panel}
      className="resident-popup"
      label={resident.name}
      testId="resident-popup"
      style={{ right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }}
    >
      <div className="resident-popup-edge" data-edge="left" data-testid="resident-popup-resize-left" onPointerDown={handle('left')} />
      <div className="resident-popup-edge" data-edge="top" data-testid="resident-popup-resize-top" onPointerDown={handle('top')} />
      <div className="resident-popup-edge" data-edge="corner" data-testid="resident-popup-resize-corner" onPointerDown={handle('corner')} />
      <Header resident={resident} onPointerDown={handle('move')} />
      {resident.setupNeeded !== null && <SetupBanner text={resident.setupNeeded} onOpenSettings={() => { onOpenSettings('residents') }} />}
      {resident.enabled
        ? (
          <>
            <ResidentConversation resident={resident} messages={messages} hits={hits} onOpen={openSession} onExample={setDraft} />
            {error !== null && <div className="resident-popup-error" role="alert">{error}</div>}
            <PermissionCards residentId={resident.id} requests={resident.permissions} />
            <ResidentComposer residentId={resident.id} name={resident.name} draft={draft} onDraft={setDraft} onSend={send} />
          </>
        )
        : (
          <div className="resident-popup-body resident-off">
            <p>{resident.name} is off.</p>
            <button type="button" className="btn small" onClick={() => { onOpenSettings('residents') }}>Enable in Settings</button>
          </div>
        )}
    </FloatingPanel>
  )
}

/**
 * The open resident's chat popup in this window, or nothing. Only its X closes it: no Escape, no
 * outside click, so a question half-typed survives a look at a session.
 */
export function ResidentPopupHost({ onOpenSettings }: { onOpenSettings: (section: string) => void }): JSX.Element | null {
  const { openId } = useResidentPopup()
  const resident = useResident(openId ?? '')
  if (openId === null || resident === null) return null
  return <Panel key={resident.id} resident={resident} onOpenSettings={onOpenSettings} />
}
