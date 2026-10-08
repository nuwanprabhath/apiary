import type { JSX } from 'react'

export interface TrendPoint { label: string; title: string; x: number; y: number }

/**
 * The monthly-trend line chart of a status-bar panel: an area under a line, a dot per point, a wider
 * invisible hit target carrying the point's tooltip, and its label along the bottom. The geometry
 * (`line`, `area`, `points`) is computed by the caller from the data; this only draws it, in the
 * panel's `status-line-*` classes.
 */
export function TrendLine({ width, height, line, area, points }: {
  width: number
  height: number
  line: string
  area: string
  points: readonly TrendPoint[]
}): JSX.Element {
  return (
    <svg className="status-line" viewBox={`0 0 ${String(width)} ${String(height)}`} preserveAspectRatio="none" role="img" aria-label="Monthly trend">
      <path d={area} className="status-line-area" />
      <path d={line} className="status-line-stroke" fill="none" />
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={3.5} className="status-line-dot" />
          <circle cx={p.x} cy={p.y} r={10} className="status-line-hit"><title>{p.title}</title></circle>
          <text x={p.x} y={height - 1} textAnchor="middle" className="status-line-label">{p.label}</text>
        </g>
      ))}
    </svg>
  )
}
