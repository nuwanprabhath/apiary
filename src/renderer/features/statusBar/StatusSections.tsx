/* eslint-disable @eslint-react/no-array-index-key -- sections, rows and cells are positional data a plugin re-sends whole; nothing is reordered or edited in place, so an index is the identity */
import type { JSX } from 'react'
import type { StatusSection } from '@shared/domain/statusBar'

/**
 * Draws a plugin's hover detail or dashboard. Each section kind is drawn here and nowhere else, so
 * a plugin describes *what* to show — a table, gauges, a chart — and never how (see
 * `@shared/domain/statusBar`). A new kind of content is a new section kind, drawn once.
 */
export function StatusSections({ sections }: { sections: StatusSection[] }): JSX.Element {
  return (
    <div className="status-sections">
      {sections.map((section, i) => <Section key={i} section={section} />)}
    </div>
  )
}

function Section({ section }: { section: StatusSection }): JSX.Element | null {
  switch (section.kind) {
    case 'heading':
      return <h3 className="status-heading">{section.text}</h3>
    case 'note':
      return <p className={section.muted === true ? 'status-note muted' : 'status-note'}>{section.text}</p>
    case 'table':
      return (
        <table className="status-table">
          <thead>
            <tr>
              {section.columns.map((c, i) => (
                <th key={i} className={i >= (section.numericFrom ?? Infinity) ? 'num' : undefined}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, r) => (
              <tr key={r} className={section.emphasiseLastRow === true && r === section.rows.length - 1 ? 'totals' : undefined}>
                {row.map((cell, i) => (
                  <td key={i} className={i >= (section.numericFrom ?? Infinity) ? 'num' : undefined}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'gauges':
      return (
        <div className="status-gauges">
          {section.gauges.map((g) => (
            <div key={g.label} className="status-gauge" data-tone={g.tone}>
              <div className="status-gauge-head"><span>{g.label}</span><span className="status-gauge-pct">{g.percent}%</span></div>
              <div className="status-gauge-track" role="meter" aria-label={g.label} aria-valuenow={g.percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="status-gauge-fill" style={{ width: `${String(Math.max(0, Math.min(100, g.percent)))}%` }} />
              </div>
              {g.caption !== '' && <div className="status-note muted">{g.caption}</div>}
            </div>
          ))}
        </div>
      )
    case 'stacked-bars': {
      const totals = section.columns.map((c) => c.values.reduce((a, b) => a + b, 0))
      const max = Math.max(1, ...totals)
      return (
        <div className="status-bars">
          <div className="status-bars-chart">
            {section.columns.map((c, i) => (
              <div key={i} className="status-bars-col" title={c.title}>
                <div className="status-bars-value muted">{c.totalLabel}</div>
                <div className="status-bars-area">
                  <div className="status-bars-bar" style={{ height: `${String((totals[i] / max) * 100)}%` }}>
                    {c.values.map((v, s) => (v > 0 && totals[i] > 0
                      ? <div key={s} className="status-bars-seg" data-series={section.series[s]?.color} style={{ height: `${String((v / totals[i]) * 100)}%` }} />
                      : null))}
                  </div>
                </div>
                <div className="status-bars-label">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="status-legend">
            {section.series.map((s) => (
              <span key={s.label} className="status-legend-item"><span className="status-swatch" data-series={s.color} />{s.label}</span>
            ))}
          </div>
        </div>
      )
    }
    case 'line': {
      const w = 640
      const h = 160
      const padX = 28
      const padY = 14
      const max = Math.max(1, ...section.points.map((p) => p.value))
      const step = section.points.length > 1 ? (w - padX * 2) / (section.points.length - 1) : 0
      const pts = section.points.map((p, i) => ({ ...p, x: padX + step * i, y: padY + (h - padY * 2) * (1 - p.value / max) }))
      if (pts.length === 0) return null
      const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
      const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${String(h - padY)} L${pts[0].x.toFixed(1)},${String(h - padY)} Z`
      return (
        <svg className="status-line" viewBox={`0 0 ${String(w)} ${String(h)}`} preserveAspectRatio="none" role="img" aria-label="Monthly trend">
          <path d={area} className="status-line-area" />
          <path d={line} className="status-line-stroke" fill="none" />
          {pts.map((p) => (
            <g key={p.label}>
              <circle cx={p.x} cy={p.y} r={3.5} className="status-line-dot" />
              <circle cx={p.x} cy={p.y} r={10} className="status-line-hit"><title>{p.title}</title></circle>
              <text x={p.x} y={h - 1} textAnchor="middle" className="status-line-label">{p.label}</text>
            </g>
          ))}
        </svg>
      )
    }
  }
}
