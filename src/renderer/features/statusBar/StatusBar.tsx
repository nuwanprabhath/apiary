import { type JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StatusBarItem, StatusBarPanel, StatusIcon } from '@shared/domain/statusBar'
import { AlertIcon, RefreshIcon } from '../../ui/icons'
import { useStatusBar } from '../../state/useStatusBar'
import { StatusSections } from './StatusSections'
import { StatusPanelDialog } from './StatusPanelDialog'
import { HOVER_DELAY_MS } from '../../ui/HoverCard'

/** A small speedometer: VS Code's `$(dashboard)`, which the usage extension shows. */
function GaugeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2.5 11.5a5.5 5.5 0 1 1 11 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 11.5l2.6-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A clock turned back: the value shown is the last one known, not a fresh one. */
function HistoryIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.2 8A4.8 4.8 0 1 0 5 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M2.8 2.8v2.6h2.6M8 5.5V8l1.8 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Icon({ icon, busy }: { icon: StatusIcon; busy: boolean }): JSX.Element {
  const cls = busy ? 'spinner' : undefined
  switch (icon) {
    case 'refresh': return <RefreshIcon className={cls} />
    case 'alert': return <AlertIcon />
    case 'history': return <HistoryIcon />
    case 'gauge': return <GaugeIcon />
  }
}

interface Props {
  /** Opens Settings at a section — the dashboard's "Settings…" goes to Plugins. */
  onOpenSettings: (section: string) => void
}

/**
 * The bar along the bottom of the session area: what the status-bar plugins contribute (Claude's
 * usage limits first), drawn as VS Code draws its status bar. Hover an item for its detail, click
 * for its action. Nothing here knows what any item is about.
 */
export function StatusBar({ onOpenSettings }: Props): JSX.Element | null {
  const items = useStatusBar()
  const [panel, setPanel] = useState<{ item: StatusBarItem; data: StatusBarPanel | null } | null>(null)

  const openPanel = async (item: StatusBarItem): Promise<void> => {
    setPanel({ item, data: null })
    try {
      const data = await window.apiary.statusBarPanel(item.pluginId, item.id)
      setPanel((cur) => (cur?.item.id === item.id && cur.item.pluginId === item.pluginId ? { item, data } : cur))
    } catch {
      setPanel(null)
    }
  }

  // Keeps an open dashboard current when the plugin's data changes (a refresh landed).
  useEffect(() => {
    if (panel === null) return
    const off = window.apiary.onStatusBarChanged(() => {
      void window.apiary.statusBarPanel(panel.item.pluginId, panel.item.id).then((data) => {
        setPanel((cur) => (cur !== null && cur.item.id === panel.item.id ? { ...cur, data } : cur))
      }).catch(() => {})
    })
    return off
  }, [panel])

  if (items.length === 0) return null
  return (
    <footer className="status-bar" data-testid="status-bar" aria-label="Status bar">
      <span className="status-bar-spacer" />
      {items.map((item) => (
        <StatusBarButton
          key={`${item.pluginId}:${item.id}`}
          item={item}
          onClick={() => {
            if (item.action.kind === 'refresh') void window.apiary.statusBarRefresh(item.pluginId)
            else if (item.action.kind === 'panel') void openPanel(item)
          }}
        />
      ))}
      {panel !== null && (
        <StatusPanelDialog
          title={panel.data?.title ?? itemTitle(panel.item)}
          panel={panel.data}
          onClose={() => { setPanel(null) }}
          onRefresh={() => { void window.apiary.statusBarRefresh(panel.item.pluginId) }}
          onOpenSettings={() => { setPanel(null); onOpenSettings('plugins') }}
        />
      )}
    </footer>
  )
}

function itemTitle(item: StatusBarItem): string {
  return item.title !== '' ? item.title : item.text
}

function StatusBarButton({ item, onClick }: { item: StatusBarItem; onClick: () => void }): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timer = useRef<number | null>(null)
  const clear = (): void => { if (timer.current !== null) window.clearTimeout(timer.current); timer.current = null }
  useEffect(() => clear, [])
  const hasDetail = item.detail.length > 0
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="status-item"
        data-testid={`status-item-${item.pluginId}-${item.id}`}
        data-tone={item.tone}
        data-stale={item.stale === true}
        aria-label={item.text !== '' ? `${item.title}: ${item.text}` : item.title}
        title={hasDetail ? undefined : item.title}
        disabled={item.action.kind === 'none'}
        onClick={() => { clear(); setAnchor(null); onClick() }}
        onMouseEnter={() => {
          if (!hasDetail) return
          clear()
          timer.current = window.setTimeout(() => { setAnchor(ref.current?.getBoundingClientRect() ?? null) }, HOVER_DELAY_MS)
        }}
        onMouseLeave={() => { clear(); setAnchor(null) }}
        onFocus={() => { if (hasDetail) setAnchor(ref.current?.getBoundingClientRect() ?? null) }}
        onBlur={() => { setAnchor(null) }}
      >
        {item.icon !== undefined && <Icon icon={item.icon} busy={item.busy === true} />}
        {item.text !== '' && <span className="status-item-text">{item.text}</span>}
        {item.stale === true && <HistoryIcon />}
      </button>
      {anchor !== null && createPortal(
        <div
          className="status-hover"
          data-testid="status-hover"
          role="tooltip"
          style={{ right: Math.max(8, window.innerWidth - anchor.right), bottom: window.innerHeight - anchor.top + 6 }}
        >
          <StatusSections sections={item.detail} />
        </div>,
        document.body,
      )}
    </>
  )
}
