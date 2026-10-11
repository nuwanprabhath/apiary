import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptMessage } from '@shared/types'
import type { ChatState } from '@shared/domain/chat'

// How close to the bottom (in pixels) counts as being at it, for following new content again.
// Deliberately tight: this used to be 64px, and a trackpad scrolls up a few pixels per event — so
// the first events of a scroll up still counted as "at the bottom", and the next streamed word
// (every 40ms in a chat) pulled the view back down. Leaving the bottom is now decided by the
// direction you scroll (see handleScroll), and only coming back all the way re-attaches.
const STICKY_BOTTOM_THRESHOLD_PX = 4
// Scrolled up further than this, the "Jump to latest" button shows.
const JUMP_BUTTON_THRESHOLD_PX = 240

/** What the page loader and the scroller share about following the tail of the transcript. */
export interface TailRefs {
  /** The scroll container. */
  containerRef: RefObject<HTMLDivElement | null>
  /** Whether the user is currently at (or very near) the bottom, so a live refresh knows
   *  whether it's allowed to auto-scroll. */
  stickToBottomRef: RefObject<boolean>
  /**
   * Set to true whenever the *next* commit of `messages` should be force-scrolled to the bottom
   * regardless of `stickToBottomRef` (a fresh session load, or a live update that arrived while
   * already stuck to the bottom). Consumed and cleared by the layout effect in the scroll hook. A
   * ref (not state) because setting it must never itself trigger an extra render.
   */
  forceScrollRef: RefObject<boolean>
}

/** Scroll container + "is the user currently at (or very near) the bottom" tracking, used for
 *  both requirements: scrolling to the bottom on open, and re-sticking to the bottom on live
 *  updates only if the user hadn't scrolled away to read history. */
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

  // Scroll-to-bottom effect. Runs after `messages` has actually committed to the DOM (layout
  // effect, not a regular effect), so it never scrolls a container that's still empty from the
  // pre-load reset. It re-runs on every `messages` change but only acts when `forceScrollRef` was
  // armed (initial load finishing, or a live update landing while already at the bottom) —
  // otherwise a `loadEarlier` prepend (which also changes `messages`) would yank the view down to
  // the bottom right after the user asked to see *earlier* content.
  useLayoutEffect(() => {
    if (!forceScrollRef.current) return
    // Stay armed while hidden rather than consuming the flag here. A display:none element has no
    // scrollHeight and ignores scrollTop, so running now would silently do nothing *and* throw
    // away the instruction — which is exactly how watching a session run in the terminal and then
    // switching to its transcript used to land you at the oldest message instead of the newest.
    // The visibility effect below performs the deferred scroll instead.
    if (!visible) return
    forceScrollRef.current = false
    const el = containerRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    // We just landed exactly at the bottom, so the user counts as "stuck" again for the next
    // live update.
    stickToBottomRef.current = true
  }, [messages, visible, containerRef, forceScrollRef, stickToBottomRef])

  /**
   * Catches the transcript up the moment it comes back on screen.
   *
   * While the live terminal is in front this component keeps running — it still receives every
   * `onTreeChanged` and merges in new messages — so the content is already current. What it cannot
   * do while hidden is move its own scroll position. Switching back therefore has to re-run the
   * scroll that was deferred above, so you land on what the session has just said rather than on
   * wherever the view happened to be parked when you left it.
   *
   * Only when the reader was following the tail: someone who deliberately scrolled up to read
   * history, then glanced at the terminal, should come back to the same place they left.
   */
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

  // Tracks whether the user is currently at (or very near) the bottom, so a live refresh knows
  // whether it's allowed to auto-scroll.
  //
  // Moving up at all leaves the bottom; only reaching it again re-attaches. Content growing never
  // moves `scrollTop`, and content shrinking under you while you sit at the bottom leaves you at
  // the bottom, so a move up is always you (or "go to this message", which is also you).
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
  // A wheel or key turned upwards says "stop following" before the scroll event even lands — the
  // first notch would otherwise race a streamed word that puts the view straight back down.
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

  // A streamed word, a permission prompt or the working line appearing keeps the view at the
  // bottom — the same rule a new message from the file follows: only if you were already there.
  useLayoutEffect(() => {
    if (!chatMode || chat === null || !stickToBottomRef.current) return
    const el = containerRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [chatMode, chat, containerRef, stickToBottomRef])

  return { showJump, onScroll, onWheel, onKeyDown, jumpToLatest }
}
