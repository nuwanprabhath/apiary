import type { JSX } from 'react'

/**
 * The MR desk's honey pot, drawn to read at 15px on the orb's dark disc: a squat amber pot with a
 * darker rim band and a highlight on the left of its belly, honey running over the rim on the right
 * into a drop, a honey surface in the mouth (`.pot-surface`, with a streak CSS swirls) and a wooden
 * dipper leaning out to the upper right (`.pot-dipper`, its own group so CSS can stir it about its
 * base in the mouth). The colours are the `--resident-*` tokens.
 */
export function HoneypotIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" width="15" height="15" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g className="pot-dipper">
        <path d="M12 10.5 19.6 2.4" stroke="var(--resident-wood)" strokeWidth="1.7" strokeLinecap="round" />
        <rect x="9.6" y="7.3" width="4" height="4.4" rx="1.6" transform="rotate(43 11.6 9.5)" fill="var(--resident-wood)" />
        <path d="M10.3 8.2l2.7 2.5M11.2 7.4l2.6 2.4" stroke="var(--resident-ink)" strokeWidth="0.6" strokeLinecap="round" />
      </g>
      <path d="M3.4 16.2C3.4 11.9 6.6 10.6 12 10.6s8.6 1.3 8.6 5.6c0 3.4-3.1 5.4-8.6 5.4s-8.6-2-8.6-5.4Z" fill="var(--resident-amber)" />
      <path d="M4.6 11.4h14.8c.6 0 1 .5 1 1s-.4 1-1 1H4.6c-.6 0-1-.5-1-1s.4-1 1-1Z" fill="var(--resident-amber-deep)" />
      <ellipse className="pot-surface" cx="12" cy="10.9" rx="6.6" ry="1.3" fill="var(--resident-gold)" />
      <path className="pot-streak" d="M8.6 10.9q3.4-1 6.4 0" stroke="var(--resident-gold-hi)" strokeWidth="0.6" strokeLinecap="round" fill="none" />
      <path d="M5.8 15.2q.2-1.6 1.4-2.2" stroke="var(--resident-gold-hi)" strokeOpacity="0.6" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      <path d="M17.6 11.2c.7 0 1.1.4 1.1 1v3.6c0 .6-.5 1-1.1 1s-1.1-.4-1.1-1v-3.6c0-.6.4-1 1.1-1Z" fill="var(--resident-gold)" />
      <path d="M17.6 17.6c.7 1 1.2 1.6 1.2 2.2a1.2 1.2 0 0 1-2.4 0c0-.6.5-1.2 1.2-2.2Z" fill="var(--resident-gold)" />
    </svg>
  )
}
