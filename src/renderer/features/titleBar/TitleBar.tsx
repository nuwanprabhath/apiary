import { type JSX, useEffect } from 'react'
import type { WindowChrome } from '@shared/domain/windowChrome'
import { THEME_CHANGE_EVENT } from '../../theme/applyTheme'
import { MenuBar } from './MenuBar'

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
 */
export function TitleBar({ chrome, title }: { chrome: WindowChrome; title: string }): JSX.Element | null {
  useEffect(() => {
    if (chrome !== 'custom') return
    const send = (): void => {
      const background = resolved('--bg-window')
      const symbol = resolved('--text')
      if (background !== null && symbol !== null) window.apiary.setTitleBarColors(background, symbol)
    }
    send()
    window.addEventListener(THEME_CHANGE_EVENT, send)
    return () => { window.removeEventListener(THEME_CHANGE_EVENT, send) }
  }, [chrome])

  if (chrome === 'system') return null
  return (
    <header className="title-bar" data-chrome={chrome} data-testid="title-bar">
      {chrome === 'custom' && <MenuBar />}
      <div className="title-bar-title" data-testid="title-bar-title">{title}</div>
    </header>
  )
}
