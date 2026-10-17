#!/usr/bin/env node
/**
 * Turns load-benchmark results (`tests/e2e/bench/loadPerf.spec.ts`) into a Markdown table and SVG
 * charts, so runs from different machines, settings or branches can be compared side by side.
 *
 *     node scripts/bench/report.mjs --out <dir> [name=]<result dir> [[name=]<result dir> ...]
 *
 * Each result dir holds the `summary.json` a run wrote; `name=dir1+dir2` charts the mean of repeated runs. Writes `<dir>/report.md` and `<dir>/*.svg`.
 * `--timeline <name>` also draws CPU over time for that run, `--memory-timeline <name>` memory; `--prefix <p>` names the files `<p>cpu.svg` and so on,
 * so several comparisons can share one folder.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v }
const out = opt('--out')
const prefix = opt('--prefix') ?? ''
const timelines = []
for (let t = opt('--timeline'); t !== undefined; t = opt('--timeline')) timelines.push(t)
const memlines = []
for (let t = opt('--memory-timeline'); t !== undefined; t = opt('--memory-timeline')) memlines.push(t)
if (out === undefined || argv.length === 0) {
  console.error('usage: report.mjs --out <dir> [--timeline <name>] [name=]<result dir> ...')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

/** The mean of several runs' summaries: numbers averaged field by field, IPC channels matched by name. */
function average(list) {
  const avg = (vals) => {
    const [first] = vals
    if (typeof first === 'number') return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
    if (Array.isArray(first)) {
      if (first.every((x) => typeof x?.channel === 'string')) {
        return first.map((c) => avg(vals.map((v) => v.find((x) => x.channel === c.channel) ?? { ...c, msgs: 0, kb: 0 })))
      }
      return first
    }
    if (first !== null && typeof first === 'object') return Object.fromEntries(Object.keys(first).map((k) => [k, avg(vals.map((v) => v?.[k]))]))
    return first
  }
  return { config: list[0].config, summary: avg(list.map((d) => d.summary)), runs: list.length }
}

// `name=dir`, or `name=dir1+dir2+...` for the mean of repeated runs.
const runs = argv.map((a) => {
  const [name, dirs] = a.includes('=') ? a.split('=') : [basename(a), a]
  const list = dirs.split('+').map((dir) => JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')))
  return { name, ...(list.length === 1 ? list[0] : average(list)) }
})

const GROUPS = ['main', 'renderers', 'gpu', 'utility', 'claude', 'shells', 'otherChildren']
const LABEL = { main: 'Main process', renderers: 'Renderers (windows)', gpu: 'GPU process', utility: 'Utility', claude: 'claude CLIs', shells: 'Shells', otherChildren: 'Other children' }
const COLOR = { main: '#d9480f', renderers: '#1c7ed6', gpu: '#7048e8', utility: '#868e96', claude: '#2b8a3e', shells: '#e67700', otherChildren: '#adb5bd' }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

function frame(width, height, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif" font-size="12">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="16" y="24" font-size="15" font-weight="bold" fill="#212529">${esc(title)}</text>
${body}
</svg>
`
}

const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p }

/** Horizontal stacked bars, one per run. */
function stacked(title, unit, value, file) {
  const labelW = 190
  const plotW = 560
  const rowH = 28
  const top = 44
  const legendH = 24 * Math.ceil(GROUPS.length / 4)
  const height = top + runs.length * rowH + 40 + legendH
  const max = niceMax(Math.max(...runs.map((r) => GROUPS.reduce((a, g) => a + value(r, g), 0))))
  const x = (v) => labelW + (v / max) * plotW
  let body = ''
  for (let i = 0; i <= 4; i += 1) {
    const v = (max * i) / 4
    body += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 4}" y2="${top + runs.length * rowH}" stroke="#e9ecef"/><text x="${x(v)}" y="${top + runs.length * rowH + 14}" text-anchor="middle" fill="#495057">${Math.round(v)}</text>`
  }
  body += `<text x="${labelW + plotW / 2}" y="${top + runs.length * rowH + 30}" text-anchor="middle" fill="#495057">${esc(unit)}</text>`
  runs.forEach((r, i) => {
    const y = top + i * rowH
    body += `<text x="${labelW - 8}" y="${y + 17}" text-anchor="end" fill="#212529">${esc(r.name)}</text>`
    let acc = 0
    for (const g of GROUPS) {
      const v = value(r, g)
      if (v <= 0) continue
      body += `<rect x="${x(acc)}" y="${y + 4}" width="${Math.max(0.5, x(acc + v) - x(acc))}" height="${rowH - 8}" fill="${COLOR[g]}"><title>${esc(LABEL[g])}: ${v}</title></rect>`
      acc += v
    }
    body += `<text x="${x(acc) + 6}" y="${y + 17}" fill="#212529">${Math.round(acc)}</text>`
  })
  const ly = top + runs.length * rowH + 44
  GROUPS.forEach((g, i) => {
    const lx = 16 + (i % 4) * 190
    const yy = ly + Math.floor(i / 4) * 22
    body += `<rect x="${lx}" y="${yy}" width="12" height="12" fill="${COLOR[g]}"/><text x="${lx + 18}" y="${yy + 10}" fill="#212529">${esc(LABEL[g])}</text>`
  })
  writeFileSync(join(out, prefix + file), frame(labelW + plotW + 60, height + 10, title, body))
}

/** Grouped horizontal bars: several measures per run. */
function grouped(title, unit, measures, file) {
  const labelW = 190
  const plotW = 560
  const barH = 12
  const rowH = barH * measures.length + 12
  const top = 44
  const height = top + runs.length * rowH + 64
  const max = niceMax(Math.max(...runs.flatMap((r) => measures.map((m) => m.value(r)))))
  const x = (v) => labelW + (v / max) * plotW
  let body = ''
  for (let i = 0; i <= 4; i += 1) {
    const v = (max * i) / 4
    body += `<line x1="${x(v)}" x2="${x(v)}" y1="${top - 4}" y2="${top + runs.length * rowH}" stroke="#e9ecef"/><text x="${x(v)}" y="${top + runs.length * rowH + 14}" text-anchor="middle" fill="#495057">${Math.round(v)}</text>`
  }
  body += `<text x="${labelW + plotW / 2}" y="${top + runs.length * rowH + 30}" text-anchor="middle" fill="#495057">${esc(unit)}</text>`
  runs.forEach((r, i) => {
    const y = top + i * rowH
    body += `<text x="${labelW - 8}" y="${y + rowH / 2 + 2}" text-anchor="end" fill="#212529">${esc(r.name)}</text>`
    measures.forEach((m, j) => {
      const v = m.value(r)
      body += `<rect x="${labelW}" y="${y + 4 + j * barH}" width="${Math.max(0.5, x(v) - labelW)}" height="${barH - 2}" fill="${m.color}"/><text x="${x(v) + 4}" y="${y + 4 + j * barH + 9}" font-size="10" fill="#212529">${v}</text>`
    })
  })
  const ly = top + runs.length * rowH + 44
  measures.forEach((m, i) => {
    body += `<rect x="${16 + i * 190}" y="${ly}" width="12" height="12" fill="${m.color}"/><text x="${34 + i * 190}" y="${ly + 10}" fill="#212529">${esc(m.label)}</text>`
  })
  writeFileSync(join(out, prefix + file), frame(labelW + plotW + 60, height, title, body))
}

/** CPU (or memory) over time for one run, one line per group. */
function timeline(run, file, series = 'cpu') {
  const rows = run.summary.series[series]
  const W = 760
  const H = 300
  const L = 50
  const T = 40
  const pw = W - L - 20
  const ph = H - T - 70
  const t0 = rows[0]?.t ?? 0
  const tmax = Math.max(1, ((rows.at(-1)?.t ?? 0) - t0) / 1000)
  const vmax = niceMax(Math.max(1, ...rows.flatMap((r) => GROUPS.map((g) => r[g]))))
  const x = (t) => L + ((t - t0) / 1000 / tmax) * pw
  const y = (v) => T + ph - (v / vmax) * ph
  let body = ''
  for (let i = 0; i <= 4; i += 1) {
    const v = (vmax * i) / 4
    body += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="#e9ecef"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="#495057">${Math.round(v)}</text>`
  }
  const step = niceMax(tmax / 6)
  for (let t = 0; t <= tmax; t += step) {
    body += `<text x="${L + (t / tmax) * pw}" y="${T + ph + 14}" text-anchor="middle" fill="#495057">${Math.round(t)}</text>`
  }
  body += `<text x="${L + pw / 2}" y="${T + ph + 30}" text-anchor="middle" fill="#495057">seconds (${series === 'cpu' ? 'CPU % of one core' : 'MB'})</text>`
  const shown = GROUPS.filter((g) => rows.some((r) => r[g] > 0.5))
  for (const g of shown) {
    body += `<polyline fill="none" stroke="${COLOR[g]}" stroke-width="1.8" points="${rows.map((r) => `${x(r.t).toFixed(1)},${y(r[g]).toFixed(1)}`).join(' ')}"/>`
  }
  shown.forEach((g, i) => {
    body += `<rect x="${16 + i * 150}" y="${H - 24}" width="12" height="12" fill="${COLOR[g]}"/><text x="${34 + i * 150}" y="${H - 14}" fill="#212529">${esc(LABEL[g])}</text>`
  })
  writeFileSync(join(out, prefix + file), frame(W, H, `${series === 'cpu' ? 'CPU' : 'Memory'} over time: ${run.name}`, body))
}

stacked('Mean CPU by process group', 'CPU % of one core (100 = one core busy)', (r, g) => r.summary.cpu[g].mean, 'cpu.svg')
stacked('Mean memory by process group', 'MB (resident / working set; shared pages counted per process)', (r, g) => r.summary.memMb[g].mean, 'memory.svg')
grouped('Key press to painted frame', 'ms', [
  { label: 'p50', color: '#74c0fc', value: (r) => r.summary.typing.endToEnd.p50 },
  { label: 'p95', color: '#1c7ed6', value: (r) => r.summary.typing.endToEnd.p95 },
  { label: 'max', color: '#0b3d91', value: (r) => r.summary.typing.endToEnd.max },
], 'typing.svg')
grouped('Jank while typing', 'per minute / ms per second / % of keys', [
  { label: 'frames over 50 ms a minute', color: '#f783ac', value: (r) => r.summary.frames.over50msPerMin },
  { label: 'long tasks, ms a second', color: '#c2255c', value: (r) => r.summary.frames.longTaskMsPerSec },
  { label: 'keys over 50 ms, %', color: '#5f3dc4', value: (r) => Math.round((1000 * r.summary.typing.over50ms) / Math.max(1, r.summary.typing.keys)) / 10 },
], 'jank.svg')
grouped('Main process event loop delay', 'ms', [
  { label: 'p99 (median second)', color: '#ffa94d', value: (r) => r.summary.mainLoop.p99Median },
  { label: 'p99 (worst second)', color: '#e8590c', value: (r) => r.summary.mainLoop.p99Worst },
  { label: 'max', color: '#862e09', value: (r) => r.summary.mainLoop.max },
], 'main-loop.svg')
for (const name of timelines) {
  const run = runs.find((r) => r.name === name)
  if (run !== undefined) timeline(run, `timeline-${name.replace(/[^a-z0-9-]/gi, '_')}.svg`)
}
for (const name of memlines) {
  const run = runs.find((r) => r.name === name)
  if (run !== undefined) timeline(run, `memory-timeline-${name.replace(/[^a-z0-9-]/gi, '_')}.svg`, 'mem')
}

const row = (cells) => `| ${cells.join(' | ')} |`
const lines = [
  '| Run | CPU total | Main | Renderers | GPU | claude | Memory total MB | Renderers MB | claude MB | Key p50 / p95 / max ms | Keys over 50 ms | Frames over 50 ms /min | Main loop p99 / max ms | IPC KB/s |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |',
  ...runs.map((r) => {
    const s = r.summary
    const ipc = s.ipcPerSecond.reduce((a, c) => a + c.kb, 0)
    return row([r.runs === undefined ? r.name : `${r.name} (mean of ${String(r.runs)})`, s.cpu.total.mean, s.cpu.main.mean, s.cpu.renderers.mean, s.cpu.gpu.mean, s.cpu.claude.mean,
      s.memMb.total.mean, s.memMb.renderers.mean, s.memMb.claude.mean,
      `${s.typing.endToEnd.p50} / ${s.typing.endToEnd.p95} / ${s.typing.endToEnd.max}`,
      `${String(Math.round((1000 * s.typing.over50ms) / Math.max(1, s.typing.keys)) / 10)}%`, s.frames.over50msPerMin,
      `${s.mainLoop.p99Median} / ${s.mainLoop.max}`, Math.round(ipc)])
  }),
]
writeFileSync(join(out, `${prefix}report.md`), `${lines.join('\n')}\n`)
console.log(lines.join('\n'))
