import { type JSX, useId } from 'react'

/**
 * The resident's bee, side on and facing right, drawn to read at 15px on the orb's dark disc: a gold
 * body with two ink bands (clipped to the body, so they follow its curve), a deep-gold head with an
 * eye and antennae, a stinger, and two pale wings that are each their own group so CSS can flutter
 * them from the root (`.bee-wing-l`, `.bee-wing-r`), as is each antenna (`.bee-antenna-front`,
 * `.bee-antenna-back`, each starting at its base on the head). The colours are the `--resident-*` tokens.
 */
export function BeeIcon({ className }: { className?: string }): JSX.Element {
  const reactId = useId()
  const clip = `bee-body-${reactId.replace(/:/g, '')}`
  return (
    <svg className={className} viewBox="0 0 24 24" width="15" height="15" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <clipPath id={clip}><ellipse cx="11.5" cy="14.5" rx="7" ry="5" /></clipPath>
      </defs>
      <g className="bee-wing-l">
        <ellipse cx="9.4" cy="7.6" rx="3.3" ry="4.9" transform="rotate(-28 9.4 7.6)" fill="var(--resident-wing)" />
      </g>
      <g className="bee-wing-r">
        <ellipse cx="13.6" cy="7.2" rx="3" ry="4.5" transform="rotate(14 13.6 7.2)" fill="var(--resident-wing)" />
      </g>
      <path d="M4.8 14.5 1.8 13.4v2.2Z" fill="var(--resident-gold-deep)" />
      <ellipse cx="11.5" cy="14.5" rx="7" ry="5" fill="var(--resident-gold)" />
      <g clipPath={`url(#${clip})`} fill="var(--resident-ink)">
        <rect x="8.2" y="8" width="2.2" height="13" />
        <rect x="12.2" y="8" width="2.2" height="13" />
      </g>
      <circle cx="19.2" cy="13.4" r="2.9" fill="var(--resident-gold-deep)" />
      <circle cx="20.2" cy="12.7" r="0.85" fill="var(--resident-ink)" />
      <g className="bee-antenna-back">
        <path d="M18.2 10.7q-.1-2.4 1.2-3.8" stroke="var(--resident-gold-hi)" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      </g>
      <g className="bee-antenna-front">
        <path d="M19.6 10.6q.6-2.6 2.6-3.4" stroke="var(--resident-gold-hi)" strokeWidth="0.9" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  )
}
