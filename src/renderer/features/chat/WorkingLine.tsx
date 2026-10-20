import { type JSX, useEffect, useState } from 'react'
import { formatDuration } from '@shared/time'
import { busyColorFor } from '@shared/domain/busyAnimation'
import { useAppSettings } from '../../state/settingsStore'
import { BusyGlyph } from '../../ui/BusyGlyph'

/** Words in the spirit of Claude Code's own, one picked per few seconds of work. */
const VERBS = [
  'Thinking', 'Pondering', 'Noodling', 'Percolating', 'Mulling', 'Brewing', 'Tinkering', 'Puzzling',
  'Wrangling', 'Conjuring', 'Simmering', 'Musing', 'Cogitating', 'Churning', 'Spelunking', 'Whirring',
]
const VERB_MS = 3000

/**
 * The line under the conversation while Claude is working, as the extension and the CLI show it:
 * the chosen animation (Settings → Themes; it moves in CSS, so the clock here only ticks seconds),
 * a changing verb in its colour, and how long it has been at it. While a thinking block is
 * streaming it says so, with Claude's running token estimate; Esc stops it (the composer listens).
 * A screen reader hears the state ("Claude is working") once; the verb and the clock change every
 * few seconds and are hidden from it, or it would read "N s" all turn long. `interruptible` is false
 * for a turn running in the session's terminal, which the message box's Esc does not stop.
 */
export function WorkingLine({ since, thinkingTokens, interruptible = true }: {
  since: number | null
  thinkingTokens: number | null
  interruptible?: boolean
}): JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  // With no `since`, the turn is timed from when this line appeared.
  const [shownAt] = useState(now)
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  useEffect(() => {
    // eslint-disable-next-line apiary/no-polling-in-features -- the elapsed seconds and the verb; there is nothing to push or share
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [])

  const start = since ?? shownAt
  const elapsedMs = Math.max(0, now - start)
  // Seeded by when the turn started, so two windows on the same turn say the same word.
  const verb = VERBS[(Math.floor(start / 1000) + Math.floor(elapsedMs / VERB_MS)) % VERBS.length]
  const detail = [formatDuration(elapsedMs)]
  if (thinkingTokens !== null) detail.push(`↓ ${thinkingTokens.toLocaleString()} tokens`)
  if (interruptible) detail.push('esc to interrupt')

  return (
    <div className="chat-working" data-testid="chat-working" data-busy-color={busyColorFor(busyAnimation, busyAnimationColor)}>
      <span className="visually-hidden" role="status">{thinkingTokens !== null ? 'Claude is thinking' : 'Claude is working'}</span>
      <span className="chat-working-glyph"><BusyGlyph animation={busyAnimation} color={busyAnimationColor} /></span>
      <span className="chat-working-verb" aria-hidden="true">{thinkingTokens !== null ? 'Thinking' : verb}…</span>
      <span className="chat-working-detail" aria-hidden="true">({detail.join(' · ')})</span>
    </div>
  )
}
