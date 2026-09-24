import type { WebContents } from 'electron'
import { log } from './log/logger'

/**
 * Keeps every window showing Apiary, and sends links to the system browser.
 *
 * Transcripts render Markdown, and Markdown links are ordinary `<a href>` elements. With nothing
 * intercepting them, clicking one navigated the window itself to that page: Apiary became a bare
 * browser with no address bar and no back button, and the only way out was to close the window.
 *
 * `will-navigate` catches a link clicked in place; `setWindowOpenHandler` catches `target=_blank`
 * and `window.open`. Both land on the same decision.
 */

export type NavigationDecision = 'allow' | 'external' | 'block'

/** Schemes it is reasonable to hand to the OS. Anything else (`file:`, `javascript:`, a custom
 *  protocol some app registered) is refused outright rather than launched. */
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * What to do with a navigation from a window currently showing `current` to `target`.
 *
 * Navigating within the app's own origin is allowed — that is a reload, or the dev server's hot
 * reload. For a `file:` app (the packaged build) the origin is opaque, so "the app" means the
 * very same file; any other file is refused.
 */
export function decideNavigation(current: string, target: string): NavigationDecision {
  let to: URL
  try { to = new URL(target) } catch { return 'block' }
  let from: URL | null = null
  try { from = new URL(current) } catch { /* no current page yet */ }

  if (from !== null) {
    if (from.protocol === 'file:' && to.protocol === 'file:' && from.pathname === to.pathname) return 'allow'
    if (from.protocol !== 'file:' && to.origin === from.origin) return 'allow'
  }
  return EXTERNAL_SCHEMES.has(to.protocol) ? 'external' : 'block'
}

/** Installs the guard on one window's contents. `openExternal` is injected for tests. */
export function guardNavigation(
  contents: WebContents,
  openExternal: (url: string) => Promise<void>,
): void {
  const act = (target: string, how: string): NavigationDecision => {
    const decision = decideNavigation(contents.getURL(), target)
    if (decision === 'external') {
      log.info('navigation', 'opened in browser', { how, scheme: new URL(target).protocol })
      openExternal(target).catch((e: unknown) => {
        log.warn('navigation', 'browser launch failed', { error: String(e) })
      })
    } else if (decision === 'block') {
      log.warn('navigation', 'blocked', { how, target: target.slice(0, 80) })
    }
    return decision
  }

  contents.on('will-navigate', (event, url) => {
    if (act(url, 'link') !== 'allow') event.preventDefault()
  })
  contents.setWindowOpenHandler(({ url }) => {
    act(url, 'new-window')
    return { action: 'deny' }
  })
}
