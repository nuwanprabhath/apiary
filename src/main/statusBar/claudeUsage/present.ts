import type { StatusSection, StatusTone, StatusBarPanel } from '@shared/domain/statusBar'
import type { Limits, WindowLimit } from './limits'
import { sumTokens, type TokenBreakdown, type TokenStats } from './tokens'

/**
 * How the Claude usage item looks — pure functions of what the plugin last learned, so the text,
 * the colours and every table are unit-tested without a clock, a network or a transcript. Same
 * wording and thresholds as the claude-usage-stats VS Code extension: `5h 10% (2:20 pm) · 7d 2%`.
 */

export interface Thresholds { warn: number; danger: number }

export const fmtTokens = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export const fmtUsd = (n: number): string =>
  n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`

/** Compact 12-hour time for the bar: "2:20 pm". */
export function resetTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
}

function resetWhen(iso: string | undefined): string {
  return iso === undefined
    ? '—'
    : new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
}

export function statusText(limits: Limits): string {
  const parts: string[] = []
  if (limits.fiveHour !== undefined) {
    const reset = limits.fiveHour.resetsAt !== undefined ? ` (${resetTime(limits.fiveHour.resetsAt)})` : ''
    parts.push(`5h ${String(Math.round(limits.fiveHour.utilization))}%${reset}`)
  }
  if (limits.sevenDay !== undefined) parts.push(`7d ${String(Math.round(limits.sevenDay.utilization))}%`)
  return parts.join(' · ') || 'Claude'
}

export function toneFor(percent: number, t: Thresholds): StatusTone {
  return percent >= t.danger ? 'danger' : percent >= t.warn ? 'warning' : 'normal'
}

export function statusTone(limits: Limits, t: Thresholds): StatusTone {
  const worst = Math.max(limits.fiveHour?.utilization ?? 0, limits.sevenDay?.utilization ?? 0)
  return toneFor(Math.round(worst), t)
}

export function relativeTime(fromMs: number, nowMs: number): string {
  const minutes = Math.round((nowMs - fromMs) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 min ago' : `${String(minutes)} mins ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${String(hours)} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? '1 day ago' : `${String(days)} days ago`
}

function limitRows(limits: Limits): { label: string; w: WindowLimit }[] {
  const rows: { label: string; w: WindowLimit | undefined }[] = [
    { label: '5-hour', w: limits.fiveHour },
    { label: '7-day', w: limits.sevenDay },
    { label: '7-day Opus', w: limits.sevenDayOpus },
  ]
  return rows.filter((r): r is { label: string; w: WindowLimit } => r.w !== undefined)
}

function topModel(stats: TokenStats): string | undefined {
  const entries = Object.entries(stats.byModel).sort((a, b) => sumTokens(b[1]) - sumTokens(a[1]))
  return entries[0]?.[0]
}

/**
 * The hover: usage (Today / Week / Month) beside the limits (Usage / Resets) — one table with a
 * spacer column, as the extension's tooltip draws it.
 */
export function detailSections(input: {
  limits: Limits | undefined
  stats: TokenStats | undefined
  stale: boolean
  error: string | undefined
  now: number
}): StatusSection[] {
  const { limits, stats, stale, error, now } = input
  const out: StatusSection[] = [{ kind: 'heading', text: 'Claude Usage' }]
  const usage = stats === undefined ? [] : (() => {
    const today = stats.days[stats.days.length - 1]
    const month = stats.months[stats.months.length - 1]
    const plus = stats.hasUnpricedModel ? '+' : ''
    return [
      ['Tokens', fmtTokens(sumTokens(today)), fmtTokens(sumTokens(stats.totals)), fmtTokens(sumTokens(month))],
      ['Cost', `${fmtUsd(today.costUsd)}${plus}`, `${fmtUsd(stats.totalCostUsd)}${plus}`, `${fmtUsd(month.costUsd)}${plus}`],
    ]
  })()
  const lim = limits === undefined ? [] : limitRows(limits).map(({ label, w }) => [label, `${String(Math.round(w.utilization))}%`, resetWhen(w.resetsAt)])
  const rowCount = Math.max(usage.length, lim.length)
  if (rowCount > 0) {
    out.push({
      kind: 'table',
      columns: ['', 'Today', 'Week', 'Month', '', '', 'Usage', 'Resets'],
      rows: Array.from({ length: rowCount }, (_, i) => [
        ...(usage[i] ?? ['', '', '', '']), '', ...(lim[i] ?? ['', '', '']),
      ]),
      numericFrom: 1,
    })
  }
  if (stats !== undefined) {
    const model = topModel(stats)
    if (model !== undefined) out.push({ kind: 'note', text: `Top model: ${model}` })
    out.push({ kind: 'note', text: `Tokens updated ${relativeTime(stats.computedAt, now)}`, muted: true })
  }
  if (limits !== undefined) {
    out.push({
      kind: 'note',
      text: `Rate limits updated ${relativeTime(limits.fetchedAt, now)}${stale && error !== undefined ? ` — ${error}` : ''}`,
      muted: true,
    })
  } else if (error !== undefined) {
    out.push({ kind: 'note', text: error })
  }
  out.push({ kind: 'note', text: 'Estimated from local Claude Code logs at published API list rates; click for the dashboard.', muted: true })
  return out
}

const SERIES: { key: keyof TokenBreakdown; label: string; color: 'series-1' | 'series-2' | 'series-3' | 'series-4' }[] = [
  { key: 'cacheRead', label: 'Cache read', color: 'series-1' },
  { key: 'cacheCreate', label: 'Cache write', color: 'series-2' },
  { key: 'input', label: 'Input', color: 'series-3' },
  { key: 'output', label: 'Output', color: 'series-4' },
]

/** The dashboard: limit gauges, the 7-day stacked chart, per-model table, monthly trend. */
export function dashboard(input: {
  limits: Limits | undefined
  stats: TokenStats
  error: string | undefined
  thresholds: Thresholds
}): StatusBarPanel {
  const { limits, stats, error, thresholds } = input
  const sections: StatusSection[] = [{ kind: 'heading', text: 'Rate limits' }]
  if (limits !== undefined && limitRows(limits).length > 0) {
    sections.push({
      kind: 'gauges',
      gauges: limitRows(limits).map(({ label, w }) => {
        const pct = Math.round(w.utilization)
        return { label, percent: pct, tone: toneFor(pct, thresholds), caption: w.resetsAt !== undefined ? `resets ${resetWhen(w.resetsAt)}` : '' }
      }),
    })
  } else {
    sections.push({ kind: 'note', text: error ?? 'No rate-limit data yet.', muted: true })
  }
  if (limits !== undefined && error !== undefined) sections.push({ kind: 'note', text: error, muted: true })

  sections.push({ kind: 'heading', text: 'Last 7 days' })
  sections.push({
    kind: 'stacked-bars',
    series: SERIES.map(({ label, color }) => ({ label, color })),
    columns: stats.days.map((d) => {
      const total = sumTokens(d)
      return {
        label: new Date(`${d.date}T00:00:00`).toLocaleDateString([], { weekday: 'short' }),
        title: `${d.date}: ${fmtTokens(total)} tokens, ${fmtUsd(d.costUsd)} (in ${fmtTokens(d.input)} / out ${fmtTokens(d.output)} / cache-r ${fmtTokens(d.cacheRead)} / cache-w ${fmtTokens(d.cacheCreate)})`,
        values: SERIES.map((s) => d[s.key]),
        totalLabel: total > 0 ? fmtTokens(total) : '',
      }
    }),
  })

  sections.push({ kind: 'heading', text: 'By model (7 days)' })
  const models = Object.entries(stats.byModel).sort((a, b) => sumTokens(b[1]) - sumTokens(a[1]))
  if (models.length === 0) {
    sections.push({ kind: 'note', text: 'No local usage found in the last 7 days.', muted: true })
  } else {
    const requests = models.reduce((n, [, m]) => n + m.requests, 0)
    sections.push({
      kind: 'table',
      columns: ['Model', 'Input', 'Output', 'Cache read', 'Cache write', 'Total', 'Cost', 'Requests'],
      numericFrom: 1,
      emphasiseLastRow: true,
      rows: [
        ...models.map(([model, m]) => [
          model, fmtTokens(m.input), fmtTokens(m.output), fmtTokens(m.cacheRead), fmtTokens(m.cacheCreate),
          fmtTokens(sumTokens(m)), m.costUsd !== undefined ? fmtUsd(m.costUsd) : '—', m.requests.toLocaleString(),
        ]),
        [
          'Total', fmtTokens(stats.totals.input), fmtTokens(stats.totals.output), fmtTokens(stats.totals.cacheRead),
          fmtTokens(stats.totals.cacheCreate), fmtTokens(sumTokens(stats.totals)),
          `${fmtUsd(stats.totalCostUsd)}${stats.hasUnpricedModel ? '+' : ''}`, requests.toLocaleString(),
        ],
      ],
    })
    sections.push({
      kind: 'note',
      muted: true,
      text: stats.hasUnpricedModel
        ? 'Cost is estimated from published API list pricing; models with no known rate are left out (shown as "+" on the total).'
        : 'Cost is estimated from published API list pricing — not your invoice; plan pricing differs.',
    })
  }

  sections.push({ kind: 'heading', text: 'Monthly tokens' })
  sections.push({
    kind: 'line',
    points: stats.months.map((m) => {
      const [y, mo] = m.month.split('-').map(Number)
      return {
        label: new Date(y, mo - 1, 1).toLocaleDateString([], { month: 'short', year: '2-digit' }),
        value: sumTokens(m),
        title: `${m.month}: ${fmtTokens(sumTokens(m))} tokens, ${fmtUsd(m.costUsd)}`,
      }
    }),
  })
  if (stats.months.every((m) => sumTokens(m) === 0)) {
    sections.push({ kind: 'note', muted: true, text: 'No monthly history yet — it fills in as you use Claude Code, limited by its transcript retention (30 days by default).' })
  }
  sections.push({ kind: 'note', muted: true, text: 'How often this refreshes, and the warning levels, are in Settings → Plugins.' })
  return { title: 'Claude Usage', sections, refreshable: true }
}
