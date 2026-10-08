/**
 * Asserts that `check` holds for the whole of `ms`, sampling it every 50ms and failing at the first
 * sample where it does not — for tests whose point is that something does *not* happen (a flicker,
 * a re-expand, a second write, no extra IPC call). A fixed wait followed by one look proves only the
 * last instant; this proves the window, and says what it was proving when it fails.
 *
 * The only sanctioned sleep in a test (`apiary/no-test-sleep` allows this file): everything else
 * waits on a condition (`vi.waitFor`, `expect.poll`, a locator assertion) or a fake clock. The e2e
 * suite re-exports it as `expectStays`, the component suite from `helpers.ts`.
 */
export async function stays(
  check: () => boolean | Promise<boolean>, ms: number, what: string,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < ms) {
    if (!(await check())) throw new Error(`Expected ${what} for ${String(ms)}ms, but it stopped after ${String(Date.now() - started)}ms`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
