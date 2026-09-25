/**
 * The refraction in liquid glass: an SVG filter the panels' `backdrop-filter` points at
 * (`url(#apiary-glass-lens)`, see styles.css), which pushes what is behind a pane outward near its
 * edges, as the rim of a lens does.
 *
 * The displacement maps are Apiary's own, fixed images — a theme contributes one number, the
 * strength, and it arrives here already clamped to 0–1 by the validator. Each map is neutral grey
 * (no displacement) except for a ramp along two opposite edges; `preserveAspectRatio="none"`
 * stretches it over whatever pane uses the filter.
 */

const ramp = (id: string, vertical: boolean, from: string, to: string): string =>
  `<linearGradient id='${id}' x1='0' y1='0' x2='${vertical ? 0 : 1}' y2='${vertical ? 1 : 0}'>` +
  `<stop offset='0' stop-color='${from}'/><stop offset='0.07' stop-color='rgb(128,128,128)'/>` +
  `<stop offset='0.93' stop-color='rgb(128,128,128)'/><stop offset='1' stop-color='${to}'/></linearGradient>`

const map = (vertical: boolean): string => {
  const [from, to] = vertical ? ['rgb(128,255,128)', 'rgb(128,0,128)'] : ['rgb(255,128,128)', 'rgb(0,128,128)']
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>` +
    `<defs>${ramp('g', vertical, from, to)}</defs><rect width='100' height='100' fill='url(#g)'/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const MAP_X = map(false)
const MAP_Y = map(true)

/**
 * Bend at full strength, as a fraction of the pane's size: the filter works in the pane's own
 * bounding-box units (the only way to make the map cover exactly the pane it is applied to — in
 * user units it covered some other box, and everything outside it read as a full shift).
 */
const MAX_SCALE = 0.06

export function GlassLens({ refraction }: { refraction: number }): JSX.Element | null {
  if (!(refraction > 0)) return null
  const scale = Number((Math.min(1, refraction) * MAX_SCALE).toFixed(4))
  return (
    <svg className="glass-lens-defs" aria-hidden="true" width="0" height="0">
      <filter
        id="apiary-glass-lens"
        x="0" y="0" width="1" height="1"
        filterUnits="objectBoundingBox"
        primitiveUnits="objectBoundingBox"
        colorInterpolationFilters="sRGB"
      >
        <feImage href={MAP_X} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
        {/* The blue channel is a constant 50% in both maps: it is the "no movement" axis. */}
        <feDisplacementMap in="SourceGraphic" in2="mx" scale={scale} xChannelSelector="R" yChannelSelector="B" result="bent" />
        <feImage href={MAP_Y} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
        <feDisplacementMap in="bent" in2="my" scale={scale} xChannelSelector="B" yChannelSelector="G" />
      </filter>
    </svg>
  )
}
