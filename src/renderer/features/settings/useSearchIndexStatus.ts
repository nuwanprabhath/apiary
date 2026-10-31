import { useEffect, useState } from 'react'
import { treeStore } from '../../state/treeStore'
import { rebuildSearchIndex, readSearchStatus } from '../../state/sessions'

/** The Search section's index counts and rebuild, held by the dialog so they load once per dialog, not per visit to Search. */
export function useSearchIndexStatus(): { indexed: number | null; notesIndexed: number; rebuilding: boolean; onRebuild: () => void } {
  const [indexed, setIndexed] = useState<number | null>(null)
  const [notesIndexed, setNotesIndexed] = useState<number>(0)
  const [rebuilding, setRebuilding] = useState(false)

  const loadIndexStatus = (): void => {
    void readSearchStatus().then((s) => {
      if (s === null) { setIndexed(null); return }
      setIndexed(s.indexed)
      setNotesIndexed(s.notes)
    })
  }
  useEffect(loadIndexStatus, [])
  // Indexing runs in the background and main announces a finished pass like a rescan, so re-read.
  useEffect(() => treeStore.onChanged(loadIndexStatus), [])

  const onRebuild = (): void => {
    setRebuilding(true)
    // The old index is still in place when this fails, so the status below stays true.
    void rebuildSearchIndex().then(() => { setRebuilding(false); loadIndexStatus() })
  }
  return { indexed, notesIndexed, rebuilding, onRebuild }
}
