import type { SessionId } from '@shared/domain/ids'
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { primaryModifier } from '../../ui/platform'
import { findInTranscript } from '../../state/transcript'
import { logBackgroundFailure } from '../../ui/fireAndForget'

const ALL = 'transcript-find'
const CURRENT = 'transcript-find-current'
// What a match is never looked for in: the toolbar and the paging and jump buttons are not the transcript.
const SKIPPED = '.transcript-toolbar, button, .find-bar'

/** One match: a painted range in a held message, or a message main found that is not held (`range` null). */
interface Hit { line: number; occ: number; range: Range | null }
/** Where the current match is, by message line and occurrence, so it survives a page landing. */
type Current = { line: number; occ: number } | 'newest'

/** What main found: matching line indexes, and where the next step of its search starts. */
interface MainHits { lines: number[]; cursor: number | null }
const NONE: MainHits = { lines: [], cursor: null }

/** Every case-insensitive occurrence of `query` in the container's text, grouped by the line index
 *  of its message; a range in an unindexed message takes a fractional key after the one before it. */
function findRanges(root: HTMLElement, query: string): { ranges: Map<number, Range[]>; held: Set<number> } {
  const needle = query.toLowerCase()
  const ranges = new Map<number, Range[]>()
  const held = new Set<number>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-index]')) held.add(Number(el.dataset.index))
  let last = -1
  let loose = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement?.closest(SKIPPED)) continue
    const owner = node.parentElement?.closest<HTMLElement>('[data-index]')
    let line: number
    if (owner?.dataset.index !== undefined) { line = Number(owner.dataset.index); last = line }
    else line = last + ++loose / 1e6
    const text = (node.textContent ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.set(line, [...(ranges.get(line) ?? []), range])
    }
  }
  return { ranges, held }
}

/** Main's hits merged with what is painted, oldest first: a held message counts each occurrence,
 *  one that is not held counts once. */
function mergeHits(root: HTMLElement, query: string, main: number[]): Hit[] {
  const { ranges, held } = findRanges(root, query)
  const lines = new Set<number>([...ranges.keys(), ...main.filter((l) => !held.has(l))])
  return [...lines].sort((a, b) => a - b).flatMap((line): Hit[] => {
    const rs = ranges.get(line)
    return rs === undefined ? [{ line, occ: 0, range: null }] : rs.map((range, occ) => ({ line, occ, range }))
  })
}

function paint(hits: Hit[], current: number): void {
  const ranges = hits.flatMap((h) => (h.range === null ? [] : [h.range]))
  if (ranges.length === 0) { CSS.highlights.delete(ALL); CSS.highlights.delete(CURRENT); return }
  CSS.highlights.set(ALL, new Highlight(...ranges))
  const now = hits[current]?.range
  if (now) CSS.highlights.set(CURRENT, new Highlight(now))
  else CSS.highlights.delete(CURRENT)
}

const indexOf = (hits: Hit[], current: Current): number => {
  if (current === 'newest') return hits.length - 1
  const at = hits.findIndex((h) => h.line === current.line && h.occ === current.occ)
  if (at !== -1) return at
  const sameLine = hits.findIndex((h) => h.line === current.line)
  return sameLine !== -1 ? sameLine : hits.length - 1
}

export interface TranscriptFind {
  open: boolean
  query: string
  setQuery: (q: string) => void
  /** 1-based position of the current match, 0 when there is none. */
  position: number
  total: number
  /** Main has more matches further back than `total` counts. */
  more: boolean
  /** -1 moves to the older match (up the transcript), 1 to the newer. */
  step: (direction: 1 | -1) => void
  close: () => void
  inputRef: RefObject<HTMLInputElement | null>
}

/** Main's search for `query`, newest first, with `more()` for the next step back. */
function useMainHits(sessionId: SessionId, open: boolean, query: string): { hits: MainHits; more: () => Promise<number | null> } {
  const [hits, setHits] = useState<MainHits>(NONE)
  const requestRef = useRef(0)
  useEffect(() => {
    const request = ++requestRef.current
    setHits(NONE)
    if (!open || query === '') return
    findInTranscript(sessionId, query, null)
      .then((r) => { if (requestRef.current === request) setHits({ lines: r.indexes, cursor: r.cursor }) })
      .catch((e: unknown) => { logBackgroundFailure(e, 'refresh') })
  }, [sessionId, open, query])
  const hitsRef = useRef(hits)
  useLayoutEffect(() => { hitsRef.current = hits })
  const more = useCallback(async () => {
    const { lines, cursor } = hitsRef.current
    if (cursor === null) return null
    const request = requestRef.current
    const r = await findInTranscript(sessionId, query, cursor)
    if (requestRef.current !== request) return null
    setHits({ lines: [...lines, ...r.indexes], cursor: r.cursor })
    return r.indexes[0] ?? null
  }, [sessionId, query])
  return { hits, more }
}

/** The chord: only this pane's transcript or composer owns it; a terminal pane never holds focus here. */
function useFindChord(containerRef: RefObject<HTMLElement | null>, visible: boolean, onChord: () => void): void {
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (!primaryModifier(e) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      const pane = containerRef.current?.closest('.pane-fill')
      if (!pane?.contains(document.activeElement)) return
      e.preventDefault()
      onChord()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [visible, containerRef, onChord])
}

/**
 * Cmd/Ctrl+F in a transcript pane. Main searches the file (`transcriptFind`), so history is never
 * paged in to be searched; the held messages' matches are painted with the CSS Highlight API (no
 * DOM is touched). Stepping to a match in a message that is not held calls `jumpTo` with its line,
 * which holds the page around it. `contentKey` changes whenever the rendered messages do.
 */
export function useTranscriptFind(opts: {
  containerRef: RefObject<HTMLElement | null>
  visible: boolean
  sessionId: SessionId
  contentKey: unknown
  jumpTo: (line: number) => void
}): TranscriptFind {
  const { containerRef, visible, sessionId, contentKey, jumpTo } = opts
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState<Current>('newest')
  const [found, setFound] = useState<{ total: number; position: number }>({ total: 0, position: 0 })
  const [focusNonce, setFocusNonce] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hitsRef = useRef<Hit[]>([])
  // A jump scrolls; a recount caused by new messages must not.
  const scrollNextRef = useRef(false)
  const main = useMainHits(sessionId, open, query)

  const close = useCallback(() => {
    setOpen(false)
    containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])

  useFindChord(containerRef, visible, useCallback(() => { setOpen(true); setFocusNonce((n) => n + 1) }, []))

  // The chord, pressed again with the bar open, selects the field's text as well.
  useEffect(() => {
    if (focusNonce === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
    scrollNextRef.current = true
    setCurrent('newest')
  }, [focusNonce])

  useEffect(() => { setOpen(false); setQuery('') }, [sessionId])

  useEffect(() => { scrollNextRef.current = true; setCurrent('newest') }, [query, open])

  useLayoutEffect(() => {
    const root = containerRef.current
    const hits = open && query !== '' && root !== null ? mergeHits(root, query, main.hits.lines) : []
    hitsRef.current = hits
    const index = indexOf(hits, current)
    setFound({ total: hits.length, position: index + 1 })
    paint(hits, index)
    const hit = hits.at(index)
    if (scrollNextRef.current && hit !== undefined) {
      if (hit.range === null) jumpTo(hit.line)
      else {
        scrollNextRef.current = false
        hit.range.startContainer.parentElement?.scrollIntoView({ block: 'center' })
      }
    }
    return () => { CSS.highlights.delete(ALL); CSS.highlights.delete(CURRENT) }
  }, [open, query, current, contentKey, containerRef, main.hits, jumpTo])

  const step = useCallback((direction: 1 | -1) => {
    const hits = hitsRef.current
    const n = hits.length
    if (n === 0) return
    const at = indexOf(hits, current)
    scrollNextRef.current = true
    // Older than the oldest found so far: ask main for the next step back before wrapping.
    if (direction === -1 && at === 0 && main.hits.cursor !== null) {
      main.more()
        .then((line) => { if (line !== null) setCurrent({ line, occ: 0 }) })
        .catch((e: unknown) => { logBackgroundFailure(e, 'refresh') })
      return
    }
    const next = hits[(at + direction + n) % n]
    setCurrent({ line: next.line, occ: next.occ })
  }, [current, main])

  return { open, query, setQuery, ...found, more: main.hits.cursor !== null, step, close, inputRef }
}
