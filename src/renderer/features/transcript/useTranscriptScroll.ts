import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import type { ChatState } from '@shared/domain/chat'

// How close to the bottom (in pixels) counts as being at it, for following new content again.
// Tight on purpose: a trackpad scrolls up a few pixels per event, so a wide threshold lets the next
// streamed word (every 40ms in a chat) pull the view back down. Leaving the bottom is decided by
// scroll direction (see onScroll); only coming back all the way re-attaches.
const STICKY_BOTTOM_THRESHOLD_PX = 4
// Scrolled up further than this, the "Jump to latest" button shows.
const JUMP_BUTTON_THRESHOLD_PX = 240

/** What the page loader and the scroller share about following the tail of the transcript. */
export interface TailRefs {
  /** The scroll container. */
  containerRef: RefObject<HTMLDivElement | null>
  /** Whether the user is at (or very near) the bottom, so a live refresh may auto-scroll. */
  stickToBottomRef: RefObject<boolean>
  /**
   * The *next* commit of `messages` is force-scrolled to the bottom regardless of
   * `stickToBottomRef`. Consumed by the layout effect in the scroll hook. A ref so setting it never
   * triggers a render.
   */
  forceScrollRef: RefObject<boolean>
}

export function useTailRefs(): TailRefs {
  return { containerRef: useRef(null), stickToBottomRef: useRef(true), forceScrollRef: useRef(false) }
}

interface ScrollInput {
  tail: TailRefs
  messages: TranscriptMessage[]
  /**
   * Whether this transcript is the pane currently on screen. A hidden element has no layout, so
   * anything that needs to *scroll* it has to wait until it is shown again.
   */
  visible: boolean
  chatMode: boolean
  chat: ChatState | null
}

/** Keeps the transcript at the bottom while the reader follows the tail, and lets go when they
 *  scroll up to read. */
export function useTranscriptScroll({ tail, messages, visible, chatMode, chat }: ScrollInput): {
  showJump: boolean
  onScroll: () => void
  onWheel: (e: { deltaY: number }) => void
  onKeyDown: (e: { key: string }) => void
  jumpToLatest: () => void
} {
  const { containerRef, stickToBottomRef, forceScrollRef } = tail

  // A layout effect, so it never scrolls a container still empty from the pre-load reset. It acts
  // only when `forceScrollRef` was armed: a `loadEarlier` prepend also changes `messages` and must
  // not yank the view to the bottom.
  useLayoutEffect(() => {
    if (!forceScrollRef.current) return
    // Stay armed while hidden: a display:none element has no scrollHeight and ignores scrollTop,
    // so running now would do nothing and discard the instruction. The visibility effect below
    // performs the deferred scroll.
    if (!visible) return
    forceScrollRef.current = false
    const el = containerRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    stickToBottomRef.current = true
  }, [messages, visible, containerRef, forceScrollRef, stickToBottomRef])

  // Re-runs the scroll deferred above when the transcript comes back on screen. Content is already
  // current (the component keeps merging while hidden); only the scroll position could not move.
  // Only when the reader was following the tail: someone who scrolled up to read history returns
  // to where they left.
  useEffect(() => {
    if (!visible) return
    if (!stickToBottomRef.current && !forceScrollRef.current) return
    const id = requestAnimationFrame(() => {
      forceScrollRef.current = false
      const el = containerRef.current
      if (el === null) return
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [visible, containerRef, forceScrollRef, stickToBottomRef])

  // Moving up at all leaves the bottom; only reaching it again re-attaches. Content growing never
  // moves `scrollTop`, and shrinking leaves you at the bottom, so a move up is always the reader.
  const lastScrollTopRef = useRef(0)
  const [showJump, setShowJump] = useState(false)
  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (el === null) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const movedUp = el.scrollTop < lastScrollTopRef.current - 1
    lastScrollTopRef.current = el.scrollTop
    if (distanceFromBottom <= STICKY_BOTTOM_THRESHOLD_PX) stickToBottomRef.current = true
    else if (movedUp) stickToBottomRef.current = false
    setShowJump(!stickToBottomRef.current && distanceFromBottom > JUMP_BUTTON_THRESHOLD_PX)
  }, [containerRef, stickToBottomRef])
  // An upward wheel or key stops following before the scroll event lands, or the first notch races
  // a streamed word that puts the view back down.
  const stopFollowing = useCallback(() => { stickToBottomRef.current = false }, [stickToBottomRef])
  const onWheel = useCallback((e: { deltaY: number }) => { if (e.deltaY < 0) stopFollowing() }, [stopFollowing])
  const onKeyDown = useCallback((e: { key: string }) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(e.key)) stopFollowing()
  }, [stopFollowing])
  const jumpToLatest = useCallback(() => {
    const el = containerRef.current
    if (el === null) return
    stickToBottomRef.current = true
    el.scrollTop = el.scrollHeight
    setShowJump(false)
  }, [containerRef, stickToBottomRef])

  // Streamed words, prompts and the working line follow the same rule as new messages: only if
  // you were already at the bottom.
  useLayoutEffect(() => {
    if (!chatMode || chat === null || !stickToBottomRef.current) return
    const el = containerRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [chatMode, chat, containerRef, stickToBottomRef])

  return { showJump, onScroll, onWheel, onKeyDown, jumpToLatest }
}
