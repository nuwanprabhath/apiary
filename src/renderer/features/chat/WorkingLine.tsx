import { type JSX, useEffect, useState } from 'react'
import { formatDuration } from '@shared/time'

/** The glyph Claude Code animates while it works, frame by frame. */
const FRAMES = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
/** Words in the spirit of Claude Code's own, one picked per few seconds of work. */
const VERBS = [
  'Thinking', 'Pondering', 'Noodling', 'Percolating', 'Mulling', 'Brewing', 'Tinkering', 'Puzzling',
  'Wrangling', 'Conjuring', 'Simmering', 'Musing', 'Cogitating', 'Churning', 'Spelunking', 'Whirring',
]
const FRAME_MS = 120
const VERB_MS = 3000

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The line under the conversation while Claude is working, as the extension and the CLI show it:
 * an animated glyph, a changing verb, and how long it has been at it. While a thinking block is
 * streaming it says so, with Claude's running token estimate; Esc stops it (the composer listens).
 * A screen reader hears the state ("Claude is working") once; the verb and the clock change every
 * few seconds and are hidden from it, or it would read "N s" all turn long.
 */
export function WorkingLine({ since, thinkingTokens }: { since: number | null; thinkingTokens: number | null }): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [reduced] = useState(prefersReducedMotion)
  useEffect(() => {
    // eslint-disable-next-line apiary/no-polling-in-features -- an animation clock for the glyph and the elapsed seconds; there is nothing to push or share
    const timer = window.setInterval(() => { setNow(Date.now()) }, reduced ? 1000 : FRAME_MS)
    return () => { window.clearInterval(timer) }
  }, [reduced])

  const start = since ?? now
  const elapsedMs = Math.max(0, now - start)
  const frame = reduced ? FRAMES[4] : FRAMES[Math.floor(now / FRAME_MS) % FRAMES.length]
  // Seeded by when the turn started, so two windows on the same turn say the same word.
  const verb = VERBS[(Math.floor(start / 1000) + Math.floor(elapsedMs / VERB_MS)) % VERBS.length]
  const detail = [formatDuration(elapsedMs)]
  if (thinkingTokens !== null) detail.push(`↓ ${thinkingTokens.toLocaleString()} tokens`)
  detail.push('esc to interrupt')

  return (
    <div className="chat-working" data-testid="chat-working">
      <span className="visually-hidden" role="status">{thinkingTokens !== null ? 'Claude is thinking' : 'Claude is working'}</span>
      <span className="chat-working-glyph" aria-hidden="true">{frame}</span>
      <span className="chat-working-verb" aria-hidden="true">{thinkingTokens !== null ? 'Thinking' : verb}…</span>
      <span className="chat-working-detail" aria-hidden="true">({detail.join(' · ')})</span>
    </div>
  )
}
