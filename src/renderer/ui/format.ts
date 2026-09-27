/** Pure display-formatting helpers with no component of their own — pulled out of SessionRow.tsx,
 *  which PaneFiller also needed and had been importing from a component module for. */

/** Days since a session was last touched, in the compact form the sidebar has room for. */
export function relativeTime(ms: number | null): string {
  if (ms === null) return ''
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d'
  return String(days) + 'd'
}

/** An absolute timestamp for the tooltip — "8d" is for the row, where space is the constraint. */
export function fullTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
