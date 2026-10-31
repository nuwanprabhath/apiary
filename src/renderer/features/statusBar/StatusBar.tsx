import { type CSSProperties, type JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { StatusBarItem, StatusBarPanel, StatusIcon } from '@shared/domain/statusBar'
import { AlertIcon, GaugeIcon, HistoryIcon, LinkIcon, RefreshIcon } from '../../ui/icons'
import { answerStatusBarConsent, onStatusBarChanged, refreshStatusBarItem, statusBarPanel, useStatusBar } from '../../state/statusBarStore'
import { reportFailure } from '../../state/policy'
import { logBackgroundFailure } from '../../ui/fireAndForget'
import { StatusSections } from './StatusSections'
import { StatusPanelDialog } from './StatusPanelDialog'
import { ConsentDialog } from './ConsentDialog'
import { ActivityIndicator } from './ActivityIndicator'
import { useAccountUsageItems } from './useAccountUsageItems'
import { useActivities } from '../../state/activityStore'
import { HOVER_DELAY_MS } from '../../ui/HoverCard'
import { ResidentBadges, useHasResidents } from '../residents'
import { type StatusBarTier, useStatusBarSize } from '../../state/statusBarSize'
import { LARGE_TEXT_FROM, residentSizesFor } from '../../state/residentSizes'
import { ContextMenu } from '../../ui/ContextMenu'
import { StatusBarResizeHandle, statusBarMenuItems } from './StatusBarResize'

/** The height, and in the tall tier the resident sizes that follow it (styles/36-residents.css reads them). */
function barStyle(height: number, tier: StatusBarTier): CSSProperties {
  const px = (n: number): string => `${String(n)}px`
  if (tier !== 'tall') return { '--status-bar-height': px(height) } as CSSProperties
  const s = residentSizesFor(height)
  return {
    '--status-bar-height': px(height),
    '--resident-orb-size-live': px(s.orb),
    '--resident-bee-size-live': px(s.bee),
    '--resident-pot-size-live': px(s.pot),
    '--resident-badge-height-live': px(s.badge),
  } as CSSProperties
}

function Icon({ icon, busy }: { icon: StatusIcon; busy: boolean }): JSX.Element {
  const cls = busy ? 'spinner' : undefined
  switch (icon) {
    case 'refresh': return <RefreshIcon className={cls} />
    case 'alert': return <AlertIcon />
    case 'history': return <HistoryIcon />
    case 'gauge': return <GaugeIcon />
    case 'link': return <LinkIcon />
  }
}

interface Props {
  /** Opens Settings at a section — the dashboard's "Settings…" goes to Plugins. */
  onOpenSettings: (section: string) => void
  /** Drawn even with no items: pets are out and stand on it. */
  keep?: boolean
}

/**
 * The bar along the bottom of the session area: what the status-bar plugins contribute (Claude's
 * usage limits first), drawn as VS Code draws its status bar. Hover an item for its detail, click
 * for its action. Nothing here knows what any item is about.
 */
export function StatusBar({ onOpenSettings, keep = false }: Props): JSX.Element | null {
  const items = useAccountUsageItems(useStatusBar())
  const busy = useActivities().length > 0
  const residents = useHasResidents()
  const [panel, setPanel] = useState<{ item: StatusBarItem; data: StatusBarPanel | null } | null>(null)
  // Plugins whose consent prompt was closed without an answer. The prompt opens by itself the first
  // time an item asks, once; clicking the item brings it back.
  const [later, setLater] = useState<ReadonlySet<string>>(() => new Set())
  const asking = items.find((i) => i.action.kind === 'consent' && !later.has(i.pluginId))
  const { height, tier } = useStatusBarSize()
  const footer = useRef<HTMLElement | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  const openPanel = async (item: StatusBarItem): Promise<void> => {
    setPanel({ item, data: null })
    try {
      const data = await statusBarPanel(item.pluginId, item.id)
      setPanel((cur) => (cur?.item.id === item.id && cur.item.pluginId === item.pluginId ? { item, data } : cur))
    } catch (e) {
      setPanel(null)
      reportFailure(e, 'Could not open the dashboard')
    }
  }

  // Keeps an open dashboard current when the plugin's data changes (a refresh landed).
  useEffect(() => {
    if (panel === null) return
    const off = onStatusBarChanged(() => {
      statusBarPanel(panel.item.pluginId, panel.item.id).then((data) => {
        setPanel((cur) => (cur !== null && cur.item.id === panel.item.id ? { ...cur, data } : cur))
      }).catch((e: unknown) => { logBackgroundFailure(e, 'status-bar') })
    })
    return off
  }, [panel])

  if (items.length === 0 && !keep && !busy && !residents) return null
  return (
    <footer
      ref={footer}
      className="status-bar"
      data-testid="status-bar"
      aria-label="Status bar"
      data-size={tier}
      data-resizing={resizing ? 'true' : undefined}
      data-text={height >= LARGE_TEXT_FROM ? 'large' : undefined}
      style={barStyle(height, tier)}
      // A badge with a menu of its own has already claimed the right-click.
      onContextMenu={(e) => { if (e.defaultPrevented) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
    >
      {resizing && <StatusBarResizeHandle height={height} bar={footer} onExit={() => { setResizing(false) }} />}
      <ActivityIndicator />
      {/* The free stretch left of the items: the floor pets walk on (features/pets). */}
      <span className="status-bar-spacer" data-testid="status-bar-floor" />
      <ResidentBadges onOpenSettings={onOpenSettings} />
      {items.map((item) => (
        <StatusBarButton
          key={`${item.pluginId}:${item.id}`}
          item={item}
          tier={tier}
          onClick={() => {
            if (item.action.kind === 'consent') setLater((cur) => new Set([...cur].filter((id) => id !== item.pluginId)))
            else if (item.action.kind === 'refresh') refreshStatusBarItem(item.pluginId)
            else if (item.action.kind === 'panel') void openPanel(item)
            else if (item.action.kind === 'settings') onOpenSettings(item.action.section)
          }}
        />
      ))}
      <ContextMenu
        items={statusBarMenuItems(height, resizing, () => { setResizing((on) => !on) })}
        position={menu}
        onClose={() => { setMenu(null) }}
        testId="status-bar-menu"
      />
      {asking?.action.kind === 'consent' && (
        <ConsentDialog
          prompt={asking.action.prompt}
          onAnswer={(allow) => { answerStatusBarConsent(asking.pluginId, allow) }}
          onLater={() => { setLater((cur) => new Set(cur).add(asking.pluginId)) }}
        />
      )}
      {panel !== null && (
        <StatusPanelDialog
          title={panel.data?.title ?? itemTitle(panel.item)}
          panel={panel.data}
          onClose={() => { setPanel(null) }}
          onRefresh={() => { refreshStatusBarItem(panel.item.pluginId) }}
          onOpenSettings={() => { setPanel(null); onOpenSettings('plugins') }}
        />
      )}
    </footer>
  )
}

function itemTitle(item: StatusBarItem): string {
  return item.title !== '' ? item.title : item.text
}

/** In the tall bar an item's text reads as a headline over the rest: split on its " · " separators. */
function ItemText({ text, tier }: { text: string; tier: StatusBarTier }): JSX.Element {
  const [first, ...rest] = text.split(' · ')
  if (tier !== 'tall' || rest.length === 0) return <span className="status-item-text">{text}</span>
  return (
    <span className="status-item-text status-item-lines">
      <span className="status-item-line1">{first}</span>
      <span className="status-item-line2">{rest.join(' · ')}</span>
    </span>
  )
}

function StatusBarButton({ item, tier, onClick }: { item: StatusBarItem; tier: StatusBarTier; onClick: () => void }): JSX.Element {
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
        {item.text !== '' && <ItemText text={item.text} tier={tier} />}
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
