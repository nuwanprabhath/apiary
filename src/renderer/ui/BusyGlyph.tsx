import type { JSX } from 'react'
import { busyColorFor, type BusyAnimationId, type BusyColorId } from '@shared/domain/busyAnimation'

const PLANETS = [1, 2, 3] as const

/** Three planets on one orbit; `tails` trailing dots behind each. */
function Planets({ tails = 0 }: { tails?: number }): JSX.Element {
  return (
    <>
      {PLANETS.flatMap((planet) => Array.from({ length: tails + 1 }, (_, tail) => (
        <span key={`${String(planet)}-${String(tail)}`} className="busy-dot" data-planet={planet} data-tail={tail} />
      )))}
    </>
  )
}

/** Each animation's marks. Everything moves in CSS (`styles/35-busy.css`): no timer, and a still
 *  frame under reduced motion. A new animation without a view here does not compile. */
const VIEWS: Record<BusyAnimationId, () => JSX.Element> = {
  spark: () => <span className="busy-spark" />,
  orbit: () => <Planets />,
  comet: () => <Planets tails={2} />,
  atom: () => <><span className="busy-nucleus" /><Planets /></>,
}

/**
 * The animation shown while Claude works, in the person's chosen colour (or the animation's own
 * first, when it does not offer that one). Decorative: the working line says it in words.
 */
export function BusyGlyph({ animation, color }: { animation: BusyAnimationId; color: BusyColorId }): JSX.Element {
  const View = VIEWS[animation]
  return (
    <span className="busy-glyph" data-busy-animation={animation} data-busy-color={busyColorFor(animation, color)} aria-hidden="true">
      <View />
    </span>
  )
}
