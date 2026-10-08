/**
 * The one way to turn something that was thrown into a line of text, on either side of the bridge.
 *
 * `e instanceof Error ? e.message : String(e)` was written 21 times, each a little differently
 * (some `String(e)`, some `'unknown error'`, some dropping non-Error rejections entirely);
 * `apiary/error-message-helper` now points here. For text shown to a person in the renderer, use
 * `describeError` (renderer/ui/errors.ts), which also strips Electron's IPC wrapping.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) ?? String(e) } catch { return String(e) }
}
