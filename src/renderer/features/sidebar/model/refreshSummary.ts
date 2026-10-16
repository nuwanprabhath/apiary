/**
 * What to say after the Refresh button has done its work.
 *
 * Refresh usually changes nothing visible (the watcher has already noticed), so without a sentence
 * the feedback is a spinner that stops. This says what the rescan found, in the terms of the list
 * on screen.
 *
 * It counts what is listed, which with a search means what matches it, hence the `filtered` wording.
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
