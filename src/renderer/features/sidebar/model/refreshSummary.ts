/**
 * What to say after the Refresh button has done its work.
 *
 * Pressing Refresh usually changes nothing visible — the watcher has normally already noticed
 * whatever is on disk — so without a sentence afterwards the only feedback is a spinner that
 * stops, which is indistinguishable from a button that does nothing. This says what the rescan
 * found, in the terms of the list the user is looking at.
 *
 * It counts what is *listed*, which with a search in the box means what matches it — hence the
 * `filtered` wording, rather than claiming a number of sessions that is not the whole library.
 */
export function describeRefresh(before: number, after: number, filtered: boolean): string {
  const noun = (n: number): string => {
    const word = n === 1 ? 'session' : 'sessions'
    return filtered ? `matching ${word}` : word
  }
  const added = after - before
  if (added > 0) return `Rescanned — ${String(added)} new ${noun(added)}.`
  if (added < 0) return `Rescanned — ${String(-added)} ${noun(-added)} no longer listed.`
  return filtered ? 'Rescanned — no change to the matches.' : 'Rescanned — no new sessions.'
}
