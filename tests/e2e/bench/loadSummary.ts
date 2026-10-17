import type { ChildSample, MainSample, RendererData } from './loadProbes'

/** What the load benchmark reports: per-group CPU (% of one core) and memory (MB), latencies in ms. */

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10
}
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10)
const stats = (xs: number[]): { mean: number; p50: number; p95: number; max: number } =>
  ({ mean: mean(xs), p50: pct(xs, 0.5), p95: pct(xs, 0.95), max: pct(xs, 1) })

export const GROUPS = ['main', 'renderers', 'gpu', 'utility', 'claude', 'shells', 'otherChildren'] as const
type Group = typeof GROUPS[number]
type Row = Record<Group, number> & { t: number }

function groupOfElectron(type: string): Group {
  if (type === 'Browser') return 'main'
  if (type === 'Tab') return 'renderers'
  if (type === 'GPU') return 'gpu'
  return 'utility'
}
function groupOfChild(kind: string): Group {
  if (kind === 'claude' || kind === 'node') return 'claude'
  if (kind === 'shell') return 'shells'
  return 'otherChildren'
}

function rows(main: MainSample[], children: ChildSample[], value: 'cpu' | 'mem'): Row[] {
  return main.map((s) => {
    const r: Row = { t: s.t, main: 0, renderers: 0, gpu: 0, utility: 0, claude: 0, shells: 0, otherChildren: 0 }
    for (const p of s.procs) r[groupOfElectron(p.type)] += value === 'cpu' ? p.cpu : p.workingSetKb / 1024
    const c = children.reduce<ChildSample | null>((best, x) => (best === null || Math.abs(x.t - s.t) < Math.abs(best.t - s.t) ? x : best), null)
    for (const p of c?.procs ?? []) r[groupOfChild(p.kind)] += value === 'cpu' ? p.cpu : p.rssKb / 1024
    for (const g of GROUPS) r[g] = Math.round(r[g] * 10) / 10
    return r
  })
}

export interface Summary {
  seconds: number
  cpu: Record<Group | 'total', { mean: number; p95: number; max: number }>
  memMb: Record<Group | 'total', { mean: number; max: number }>
  rendererByWindow: { window: number; cpuMean: number; memMbMean: number; jsHeapMbAtEnd: number | null }[]
  mainLoop: { p50Mean: number; p99Median: number; p99Worst: number; max: number }
  mainHeapMb: number
  ipcPerSecond: { channel: string; msgs: number; kb: number }[]
  typing: {
    keys: number
    endToEnd: { mean: number; p50: number; p95: number; max: number }
    inRenderer: { mean: number; p50: number; p95: number; max: number }
    over50ms: number
    over100ms: number
    slowEvents: { count: number; p95: number; inputDelayMax: number }
  }
  frames: { p50: number; p95: number; over50msPerMin: number; longTaskMsPerSec: number }
  topLongFrameScripts: { script: string; ms: number; count: number }[]
  series: { cpu: Row[]; mem: Row[]; loopP99: { t: number; v: number }[] }
}

export function summarise(input: {
  config: unknown
  main: { samples: MainSample[]; windows: { number: number; pid: number }[] }
  childSamples: ChildSample[]
  renderers: RendererData[]
  keySends: { window: number; sent: number[] }[]
  /** Samples after this time (profiling, tracing) are left out. */
  until: number
}): Summary {
  const samples = input.main.samples.filter((s) => s.t <= input.until)
  const children = input.childSamples.filter((s) => s.t <= input.until)
  const cpuRows = rows(samples, children, 'cpu')
  const memRows = rows(samples, children, 'mem')
  const seconds = samples.length
  const total = (r: Row): number => GROUPS.reduce((a, g) => a + r[g], 0)

  const cpu = Object.fromEntries([...GROUPS.map((g) => [g, cpuRows.map((r) => r[g])] as const), ['total', cpuRows.map(total)] as const]
    .map(([g, xs]) => [g, { mean: mean(xs), p95: pct(xs, 0.95), max: pct(xs, 1) }])) as Summary['cpu']
  const memMb = Object.fromEntries([...GROUPS.map((g) => [g, memRows.map((r) => r[g])] as const), ['total', memRows.map(total)] as const]
    .map(([g, xs]) => [g, { mean: Math.round(mean(xs)), max: Math.round(pct(xs, 1)) }])) as Summary['memMb']

  const rendererByWindow = input.main.windows.map(({ number, pid }) => {
    const own = samples.map((s) => s.procs.find((p) => p.pid === pid)).filter((p) => p !== undefined)
    return {
      window: number, cpuMean: mean(own.map((p) => p.cpu)), memMbMean: Math.round(mean(own.map((p) => p.workingSetKb / 1024))),
      jsHeapMbAtEnd: input.renderers.find((r) => r.window === number)?.heapMb ?? null,
    }
  })

  const ipc = new Map<string, { msgs: number; bytes: number }>()
  for (const s of samples) {
    for (const [ch, n] of Object.entries(s.ipc)) {
      const e = ipc.get(ch) ?? { msgs: 0, bytes: 0 }
      e.msgs += n
      e.bytes += s.ipcBytes[ch] ?? 0
      ipc.set(ch, e)
    }
  }
  const ipcPerSecond = [...ipc.entries()]
    .map(([channel, e]) => ({ channel, msgs: Math.round((10 * e.msgs) / Math.max(1, seconds)) / 10, kb: Math.round(e.bytes / 1024 / Math.max(1, seconds)) }))
    .sort((a, b) => b.kb - a.kb || b.msgs - a.msgs)

  const e2e: number[] = []
  const inRenderer: number[] = []
  for (const r of input.renderers) {
    const sent = input.keySends.find((k) => k.window === r.window)?.sent ?? []
    const n = Math.min(sent.length, r.keys.length)
    for (let i = 0; i < n; i += 1) {
      const k = r.keys[i]
      if (k.paintMs <= 0) continue
      inRenderer.push(k.paintMs)
      e2e.push(k.t0Epoch + k.paintMs - sent[i])
    }
  }
  const events = input.renderers.flatMap((r) => r.events)
  const frames = input.renderers.flatMap((r) => r.frames)
  const longTaskMs = input.renderers.flatMap((r) => r.longTasks).reduce((a, b) => a + b, 0)

  const scripts = new Map<string, { ms: number; count: number }>()
  for (const l of input.renderers.flatMap((r) => r.loafs)) {
    for (const s of l.scripts) {
      const key = `${s.invoker} ${s.source}${s.fn ? ` ${s.fn}` : ''}`
      const e = scripts.get(key) ?? { ms: 0, count: 0 }
      e.ms += s.duration
      e.count += 1
      scripts.set(key, e)
    }
  }

  const s = (xs: number[]): ReturnType<typeof stats> => stats(xs.map((x) => Math.round(x * 10) / 10))
  return {
    seconds,
    cpu,
    memMb,
    rendererByWindow,
    mainLoop: {
      p50Mean: mean(samples.map((x) => x.loop.p50)),
      p99Median: pct(samples.map((x) => x.loop.p99), 0.5),
      p99Worst: pct(samples.map((x) => x.loop.p99), 1),
      max: pct(samples.map((x) => x.loop.max), 1),
    },
    mainHeapMb: Math.round(mean(samples.map((x) => x.heapUsedMb))),
    ipcPerSecond,
    typing: {
      keys: e2e.length,
      endToEnd: s(e2e),
      inRenderer: s(inRenderer),
      over50ms: e2e.filter((x) => x > 50).length,
      over100ms: e2e.filter((x) => x > 100).length,
      slowEvents: { count: events.length, p95: pct(events.map((e) => e.duration), 0.95), inputDelayMax: pct(events.map((e) => e.inputDelay), 1) },
    },
    frames: {
      p50: pct(frames, 0.5),
      p95: pct(frames, 0.95),
      over50msPerMin: Math.round((frames.filter((f) => f > 50).length / Math.max(1, seconds)) * 60 * 10) / 10,
      longTaskMsPerSec: Math.round(longTaskMs / Math.max(1, seconds) / Math.max(1, input.renderers.length)),
    },
    topLongFrameScripts: [...scripts.entries()].map(([script, e]) => ({ script, ...e })).sort((a, b) => b.ms - a.ms).slice(0, 15),
    series: { cpu: cpuRows, mem: memRows, loopP99: samples.map((x) => ({ t: x.t, v: x.loop.p99 })) },
  }
}
