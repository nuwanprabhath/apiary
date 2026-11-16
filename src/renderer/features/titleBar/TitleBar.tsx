import { type JSX, useEffect } from 'react'
import type { WindowChrome } from '@shared/domain/windowChrome'
import { THEME_CHANGE_EVENT } from '../../theme/applyTheme'
import { MenuBar } from './MenuBar'
import { setTitleBarColors } from '../../state/windowChrome'
import { remoteHost } from '../../state/windowParams'
import { RemoteBadge } from '../remote'

/** A computed CSS colour (`rgb(…)`/`rgba(…)`) as `#rrggbb`, alpha dropped — the overlay is opaque. */
export function cssColorToHex(value: string): string | null {
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value)
  if (m === null) return null
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
}

/** Resolves a token to the colour the browser actually paints, whatever syntax the theme used. */
function resolved(token: string): string | null {
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return cssColorToHex(value)
}

/**
 * The window's title bar, in the theme's colours (Windows and Linux: with the application menu;
 * macOS: a strip beside the traffic lights). On a custom bar the OS still draws minimise, maximise
 * and close, over the bar's right end, in the colours sent here — re-sent on every theme change.
 * A remote window's bar is filled with the accent, so it stands out from this machine's windows in
 * the OS's window overview, where the host chip is too small to read.
 */
export function TitleBar({ chrome, title }: { chrome: WindowChrome; title: string }): JSX.Element | null {
  useEffect(() => {
    if (chrome !== 'custom') return
    const remote = remoteHost() !== null
    const send = (): void => {
      const background = resolved(remote ? '--accent' : '--bg-window')
      const symbol = resolved(remote ? '--accent-contrast' : '--text')
      if (background !== null && symbol !== null) setTitleBarColors(background, symbol)
    }
    send()
    window.addEventListener(THEME_CHANGE_EVENT, send)
    return () => { window.removeEventListener(THEME_CHANGE_EVENT, send) }
  }, [chrome])

  const host = remoteHost()
  if (chrome === 'system') return null
  return (
    <header className="title-bar" data-chrome={chrome} data-remote={host !== null ? 'true' : undefined} data-testid="title-bar">
      {chrome === 'custom' && <MenuBar />}
      <div className="title-bar-title" data-testid="title-bar-title">
        {host !== null && <RemoteBadge host={host} />}
        <span className="title-bar-title-text" title={title}>{title}</span>
      </div>
    </header>
  )
}
