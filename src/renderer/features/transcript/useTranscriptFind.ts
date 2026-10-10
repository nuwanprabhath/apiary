import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const ALL = 'transcript-find'
const CURRENT = 'transcript-find-current'
// What a match is never looked for in: the toolbar and the paging and jump buttons are not the transcript.
const SKIPPED = '.transcript-toolbar, button, .find-bar'

// Clamped to the last match, so a fresh query starts at the newest.
const NEWEST = Number.MAX_SAFE_INTEGER

const isMac =(): boolean => navigator.userAgent.includes('Mac')

/** Every case-insensitive occurrence of `query` in the container's text, as DOM ranges. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.toLowerCase()
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.parentElement?.closest(SKIPPED)) continue
    const text = (node.textContent ?? '').toLowerCase()
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}

function paint(ranges: Range[], current: number): void {
  if (ranges.length === 0) { CSS.highlights.delete(ALL); CSS.highlights.delete(CURRENT); return }
  CSS.highlights.set(ALL, new Highlight(...ranges))
  CSS.highlights.set(CURRENT, new Highlight(ranges[current]))
}

export interface TranscriptFind {
  open: boolean
  query: string
  setQuery: (q: string) => void
  /** 1-based position of the current match, 0 when there is none. */
  position: number
  total: number
  /** -1 moves to the older match (up the transcript), 1 to the newer. */
  step: (direction: 1 | -1) => void
  close: () => void
  inputRef: RefObject<HTMLInputElement | null>
}

/**
 * Cmd/Ctrl+F in a transcript pane: the matches of a query, painted with the CSS Highlight API (no
 * DOM is touched, so the markdown stays as rendered). `contentKey` changes whenever the rendered
 * messages do. While a query is set, earlier pages are loaded so the whole transcript is searched.
 */
export function useTranscriptFind(opts: {
  containerRef: RefObject<HTMLElement | null>
  visible: boolean
  sessionId: string
  contentKey: unknown
  hasEarlier: boolean
  loadEarlier: () => void
}): TranscriptFind {
  const { containerRef, visible, sessionId, contentKey, hasEarlier, loadEarlier } = opts
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(NEWEST)
  const [total, setTotal] = useState(0)
  const [focusNonce, setFocusNonce] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rangesRef = useRef<Range[]>([])
  // A jump scrolls; a recount caused by new messages must not.
  const scrollNextRef = useRef(false)

  const close = useCallback(() => {
    setOpen(false)
    containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])

  // Only this pane's transcript or composer owns the chord; a terminal pane never holds focus here.
  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent): void => {
      const mod = isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
      const pane = containerRef.current?.closest('.pane-fill')
      if (!pane?.contains(document.activeElement)) return
      e.preventDefault()
      setOpen(true)
      setFocusNonce((n) => n + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [visible, containerRef])

  // The chord, pressed again with the bar open, selects the field's text as well.
  useEffect(() => {
    if (focusNonce === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
    scrollNextRef.current = true
    setCurrent(NEWEST)
  }, [focusNonce])

  useEffect(() => { setOpen(false); setQuery('') }, [sessionId])

  // Page in the rest of the history while a query is looking for matches in it.
  useEffect(() => {
    if (open && query !== '' && hasEarlier) loadEarlier()
  }, [open, query, hasEarlier, loadEarlier])

  useEffect(() => { scrollNextRef.current = true; setCurrent(NEWEST) }, [query, open])

  useLayoutEffect(() => {
    const root = containerRef.current
    const ranges = open && query !== '' && root !== null ? findRanges(root, query) : []
    rangesRef.current = ranges
    setTotal(ranges.length)
    const index = Math.min(current, Math.max(ranges.length - 1, 0))
    paint(ranges, index)
    if (scrollNextRef.current && ranges.length > 0) {
      scrollNextRef.current = false
      ranges[index].startContainer.parentElement?.scrollIntoView({ block: 'center' })
    }
    return () => { CSS.highlights.delete(ALL); CSS.highlights.delete(CURRENT) }
  }, [open, query, current, contentKey, containerRef])

  const step = useCallback((direction: 1 | -1) => {
    const n = rangesRef.current.length
    if (n === 0) return
    scrollNextRef.current = true
    setCurrent((c) => (Math.min(c, n - 1) + direction + n) % n)
  }, [])

  return {
    open, query, setQuery, position: total === 0 ? 0 : Math.min(current, total - 1) + 1, total, step, close, inputRef,
  }
}
