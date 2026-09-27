import type { Session } from 'electron'

/**
 * Electron grants every permission a page asks for by default, with no handler installed at all.
 * The renderer only ever needs the clipboard (`TerminalView.tsx`'s paste path reads it, and xterm's
 * own copy writes it) — camera, microphone, screen capture, geolocation, notifications and
 * HID/serial/USB are not features of this app, so they are refused outright (SEC-10): least
 * privilege, so a future renderer bug cannot also turn on the camera.
 */
export const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])

/**
 * Whether `url` is this app's own page, judged the same way the *old* `navigationGuard` judged a
 * same-app navigation: exact pathname for a packaged `file:` build (its origin is opaque, so
 * "the app" means the very same file), same origin otherwise (the dev server). This is
 * deliberately looser than `decideNavigation`'s post-SEC-2 exact-URL rule — that rule exists to
 * stop a transcript link from reloading the window with a different query, which is not a concern
 * here: a permission check only has to say "is the caller Apiary's own renderer", not "is this
 * the exact page currently on screen".
 */
export function isAppUrl(url: string, currentUrl: string): boolean {
  let target: URL
  let current: URL
  try { target = new URL(url) } catch { return false }
  try { current = new URL(currentUrl) } catch { return false }
  if (current.protocol === 'file:') return target.protocol === 'file:' && target.pathname === current.pathname
  return target.origin === current.origin
}

/** Pure decision function, so the policy is unit-testable without a real Electron session. */
export function allowPermission(permission: string, requestingUrl: string, currentUrl: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl, currentUrl)
}

/**
 * Installs the permission guard on a session. Must run before any window is created — Electron's
 * default (grant everything) applies to any request made before a handler is registered.
 */
export function installPermissionGuards(session: Session): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowPermission(permission, details.requestingUrl, webContents.getURL()))
  })
  session.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
    allowPermission(permission, requestingOrigin, webContents?.getURL() ?? ''))
  // HID, serial and USB each have their own device-picker handler; Electron shows nothing (and so
  // grants nothing) without one, but denying explicitly is the point being made, not an accident
  // of no handler existing.
  session.setDevicePermissionHandler(() => false)
}
