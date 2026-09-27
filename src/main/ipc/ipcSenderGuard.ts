/**
 * Whether an IPC message's sender frame is Apiary's own renderer page, not some other page a
 * compromised or buggy renderer had navigated to (SEC-8 step 8 — one of the two SEC-8 items the
 * lead review reserved for MAIN-11's registrar; landed standalone here since the registrar itself
 * was judged too large a change to take on safely alongside this work package's other findings —
 * see the WP report).
 *
 * The renderer's real URL always carries a window-number query, and a detached window's carries
 * `?detach=`/`?transfer=` on top of that — so this compares scheme and pathname (a packaged
 * `file://.../renderer/index.html`) or origin (the Vite dev server), never the full URL including
 * its query string. `event.senderFrame` is Electron's own answer to "who actually sent this", set
 * from the process that holds the port — unlike anything read from the renderer's own JS context,
 * it cannot be spoofed by script running in a compromised page.
 */
export interface TrustedRendererConfig {
  /** Set when running against the Vite dev server (`ELECTRON_RENDERER_URL`); null for a packaged
   *  or built run, where the renderer is loaded from a `file://` path instead. */
  devServerOrigin: string | null
}

export function isTrustedRendererUrl(url: string, expected: TrustedRendererConfig): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (expected.devServerOrigin !== null) return parsed.origin === expected.devServerOrigin
  return parsed.protocol === 'file:' && parsed.pathname.endsWith('/renderer/index.html')
}

/**
 * `senderFrame` is only ever missing for a synthetic call — nothing that reaches this from Electron
 * itself omits it. Test harnesses that invoke a handler directly (`ipcHandlers.get(channel)?.({})`,
 * as `tests/integration/ipcWiring.test.ts` does) have no real sender to check, so this allows
 * rather than denies when there is nothing to check against; a `null` `expected` means the same
 * thing for the whole app (no dev server / packaged config was ever wired in, e.g. this test file),
 * and is likewise not enforced.
 */
export function isTrustedSender(
  senderFrameUrl: string | undefined,
  expected: TrustedRendererConfig | null,
): boolean {
  if (expected === null || senderFrameUrl === undefined) return true
  return isTrustedRendererUrl(senderFrameUrl, expected)
}
