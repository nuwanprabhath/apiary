import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { BrowseEntry, BrowseView } from '@shared/domain/folders'
import type { NewSessionInfo } from '@shared/domain/session'
import {
  closeFolderBrowse, enterBrowsedFolder, jumpToBrowsedCrumb, openFolderBrowse, startSessionInBrowsedFolder, upBrowsedFolder,
} from '../../state/folderBrowser'
import { describeError } from '../../ui/errors'
import { useListboxNav } from '../../ui/Listbox'

export interface FolderBrowse {
  view: BrowseView | null
  entries: BrowseEntry[]
  /** The name of the folder being shown ('' until the first view arrives). */
  here: string
  atRoot: boolean
  error: string | null
  busy: boolean
  selected: string | null
  activeIndex: number
  select: (name: string) => void
  enter: (name: string) => void
  up: () => void
  jump: (index: number) => void
  start: () => void
  /** Up/Down/Enter on the list, and Backspace for "up". */
  onKeyDown: (e: KeyboardEvent) => void
}

/**
 * One folder browse of the work machine: opens on mount, closes on unmount, and runs each step
 * (enter, up, jump) one at a time. A refusal or failure lands in `error` and leaves the view as it was.
 */
export function useFolderBrowse(onStarted: (info: NewSessionInfo) => void): FolderBrowse {
  const [view, setView] = useState<BrowseView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const idRef = useRef<string | null>(null)

  useEffect(() => {
    let gone = false
    openFolderBrowse().then(
      (first) => {
        if (gone) { closeFolderBrowse(first.id); return }
        idRef.current = first.id
        setView(first)
      },
      (e: unknown) => { if (!gone) setError(describeError(e).message) },
    )
    return () => {
      gone = true
      if (idRef.current !== null) closeFolderBrowse(idRef.current)
    }
  }, [])

  /** Runs one step and shows where it lands, or the refusal where the list was. */
  const step = useCallback(async (run: (id: string) => Promise<BrowseView>, select: string | null = null): Promise<void> => {
    const id = idRef.current
    if (id === null || busy) return
    setBusy(true)
    try {
      setView(await run(id))
      setSelected(select)
      setError(null)
    } catch (e) {
      setError(describeError(e).message)
    } finally {
      setBusy(false)
    }
  }, [busy])

  const entries = view?.entries ?? []
  const here = view === null ? '' : (view.crumbs[view.crumbs.length - 1] ?? '')
  const atRoot = view === null || view.atRoot
  const activeIndex = entries.findIndex((e) => e.name === selected)

  const enter = (name: string): void => { void step((id) => enterBrowsedFolder(id, name)) }
  // Coming back up selects the folder just left, so Enter then Backspace round-trips.
  const up = (): void => { void step((id) => upBrowsedFolder(id), here) }
  const jump = (index: number): void => { void step((id) => jumpToBrowsedCrumb(id, index)) }
  const start = (): void => {
    const id = idRef.current
    if (id === null || busy) return
    setBusy(true)
    startSessionInBrowsedFolder(id).then(onStarted, (e: unknown) => {
      setError(describeError(e).message)
      setBusy(false)
    })
  }

  const nav = useListboxNav({
    count: entries.length,
    active: activeIndex,
    setActive: (i) => { setSelected(entries[i]?.name ?? null) },
    onChoose: () => { if (selected !== null) enter(selected) },
    edges: true,
  })
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (!atRoot) up()
      return
    }
    nav.onKeyDown(e)
  }

  return { view, entries, here, atRoot, error, busy, selected, activeIndex, select: setSelected, enter, up, jump, start, onKeyDown }
}
