/**
 * Starts, stops or re-times the periodic rescan, for sessions that appear without a watched file
 * changing (one started in a terminal outside Apiary). Off by default (null interval): every pass
 * shells out to git once per project directory.
 *
 * Re-armed after each run rather than a `setInterval`, so a slow scan is not stacked behind itself.
 * Returns the setter; `null` stops it.
 */
export function createAutoImport(rescan: () => void): (intervalMinutes: number | null) => void {
  let timer: NodeJS.Timeout | null = null
  return (intervalMinutes) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (intervalMinutes === null || intervalMinutes <= 0) return
    const scheduleNext = (): void => {
      timer = setTimeout(() => {
        rescan()
        scheduleNext()
      }, intervalMinutes * 60 * 1000)
    }
    scheduleNext()
  }
}
