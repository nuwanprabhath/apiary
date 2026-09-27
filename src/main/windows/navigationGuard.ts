import type { WebContents } from 'electron'
import { log } from '../log/logger'

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

/** `href` with the hash removed, so a same-page anchor jump still counts as a reload. */
function stripHash(href: string): string {
  const i = href.indexOf('#')
  return i === -1 ? href : href.slice(0, i)
}

/**
 * What to do with a navigation from a window currently showing `current` to `target`.
 *
 * Navigating within the app's own origin is allowed only when it is an exact reload of the
 * current page (ignoring the hash) — not merely the same pathname or origin. A transcript
 * rendered as markdown can contain a link to `?restore={...}`; DOMPurify now strips relative
 * hrefs (see `MarkdownText.tsx`), but this is the second layer: even a same-origin link with a
 * changed query is refused, so clicking one can never reload the window with an attacker-chosen
 * query that auto-resumes whatever sessions it names (SEC-2). A genuine reload — the app's own
 * "Reset" or a dev-server hot reload — always targets the exact same URL, so this loses nothing
 * legitimate.
 */
export function decideNavigation(current: string, target: string): NavigationDecision {
  let to: URL
  try { to = new URL(target) } catch { return 'block' }
  let from: URL | null = null
  try { from = new URL(current) } catch { /* no current page yet */ }

  if (from !== null && stripHash(to.href) === stripHash(from.href)) return 'allow'
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
