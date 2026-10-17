import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * The load benchmark's instruments. Three vantage points, each sampling itself so the harness's
 * own round trips do not land in what is measured:
 * - main: `app.getAppMetrics()` for every Electron process (main, renderers, GPU, utility), the
 *   main event loop's delay (a keystroke reaches a window through main's UI thread, so a stalled
 *   loop is typing lag in every window), and how many IPC messages each window was sent;
 * - each window: frame intervals, long animation frames with the scripts that ran in them, and the
 *   time from each key press to the frame that showed it;
 * - the machine: CPU and memory of the processes Apiary started (`claude`, shells, git), from `ps`
 *   or `/proc`.
 */

export interface ProcSample { pid: number; type: string; name: string; cpu: number; wakeups: number; workingSetKb: number; privateKb: number | null }
export interface MainSample {
  t: number
  procs: ProcSample[]
  /** Main event loop delay over the interval, ms. */
  loop: { p50: number; p99: number; max: number; mean: number }
  heapUsedMb: number
  /** Messages sent to renderers over the interval, by channel. */
  ipc: Record<string, number>
  /** Estimated bytes sent over the interval, by channel (every 10th message is serialised and counted ten times). */
  ipcBytes: Record<string, number>
}
export interface ChildSample { t: number; procs: { pid: number; kind: string; cpu: number; rssKb: number }[] }
export interface KeyTiming { t0Epoch: number; handledMs: number; paintMs: number }
export interface LoafSummary { duration: number; blocking: number; scripts: { invoker: string; source: string; fn: string; duration: number }[] }
export interface RendererData {
  window: number
  frames: number[]
  longTasks: number[]
  loafs: LoafSummary[]
  keys: KeyTiming[]
  /** Event Timing entries of 16 ms or more for key and input events: start-to-presented duration and input delay. */
  events: { name: string; duration: number; inputDelay: number; processing: number }[]
  heapMb: number | null
}

/** Starts main's own sampler; `collectMain` stops it and returns what it gathered. */
export async function startMainSampler(app: ElectronApplication, intervalMs: number): Promise<void> {
  await app.evaluate(({ app: electronApp, BrowserWindow, ipcMain }, interval) => {
    interface Holder { __apiaryBench?: { samples: unknown[]; stop: () => void } }
    const perf = process.getBuiltinModule('node:perf_hooks')
    const loop = perf.monitorEventLoopDelay({ resolution: 5 })
    loop.enable()
    const ipc: Record<string, number> = {}
    const ipcBytes: Record<string, number> = {}
    let seen = 0
    const patched = new WeakSet<object>()
    const patch = (win: Electron.BrowserWindow): void => {
      const wc = win.webContents
      if (patched.has(wc)) return
      patched.add(wc)
      const original = wc.send.bind(wc)
      wc.send = (channel: string, ...args: unknown[]): void => {
        ipc[channel] = (ipc[channel] ?? 0) + 1
        seen += 1
        if (seen % 10 === 0) {
          try { ipcBytes[channel] = (ipcBytes[channel] ?? 0) + 10 * JSON.stringify(args).length } catch { /* not JSON-able: not counted */ }
        }
        original(channel, ...args)
      }
    }
    for (const win of BrowserWindow.getAllWindows()) patch(win)
    // Invoke replies (a window asking main, e.g. `transcript`) do not go through `send`: wrap the
    // handlers Electron keeps in `ipcMain._invokeHandlers`, an internal Map, for the bench only.
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...a: unknown[]) => unknown> })._invokeHandlers
    for (const [channel, handler] of handlers ?? []) {
      handlers?.set(channel, async (...a: unknown[]) => {
        const result = await handler(...a)
        const key = `invoke ${channel}`
        ipc[key] = (ipc[key] ?? 0) + 1
        try { ipcBytes[key] = (ipcBytes[key] ?? 0) + JSON.stringify(result ?? null).length } catch { /* not JSON-able */ }
        return result
      })
    }
    electronApp.on('browser-window-created', (_e, win) => { patch(win) })
    electronApp.getAppMetrics()
    const samples: unknown[] = []
    const timer = setInterval(() => {
      const procs = electronApp.getAppMetrics().map((m) => ({
        pid: m.pid,
        type: m.type,
        name: m.name ?? m.serviceName ?? '',
        cpu: m.cpu.percentCPUUsage,
        wakeups: m.cpu.idleWakeupsPerSecond,
        workingSetKb: m.memory.workingSetSize,
        privateKb: m.memory.privateBytes ?? null,
      }))
      const ms = (ns: number): number => Math.round(ns / 1e4) / 100
      samples.push({
        t: Date.now(),
        procs,
        loop: { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max), mean: ms(loop.mean) },
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
        ipc: { ...ipc },
        ipcBytes: { ...ipcBytes },
      })
      loop.reset()
      for (const k of Object.keys(ipc)) delete ipc[k]
      for (const k of Object.keys(ipcBytes)) delete ipcBytes[k]
    }, interval)
    ;(globalThis as Holder).__apiaryBench = { samples, stop: () => { clearInterval(timer); loop.disable() } }
  }, intervalMs)
}

export async function collectMain(app: ElectronApplication): Promise<{ samples: MainSample[]; windows: { number: number; pid: number }[]; gpu: unknown }> {
  return app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
    interface Holder { __apiaryBench?: { samples: unknown[]; stop: () => void } }
    const bench = (globalThis as Holder).__apiaryBench
    bench?.stop()
    const windows = BrowserWindow.getAllWindows().map((w) => {
      const url = new URL(w.webContents.getURL())
      return { number: Number(url.searchParams.get('w') ?? '0'), pid: w.webContents.getOSProcessId() }
    })
    return {
      samples: (bench?.samples ?? []) as never,
      windows,
      // getGPUInfo rejects when the GPU is switched off (`--disable-gpu`).
      gpu: { status: electronApp.getGPUFeatureStatus(), info: await electronApp.getGPUInfo('basic').catch((e: unknown) => String(e)) },
    }
  })
}

/** Installs the per-window probe. Key timings are taken only between `setTyping(page, true)` and `false`. */
export async function installRendererProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    interface Bench {
      on: boolean; typing: boolean
      frames: number[]; longTasks: number[]
      loafs: { duration: number; blocking: number; scripts: { invoker: string; source: string; fn: string; duration: number }[] }[]
      keys: { t0Epoch: number; handledMs: number; paintMs: number }[]
      events: { name: string; duration: number; inputDelay: number; processing: number }[]
    }
    const w = window as Window & { __apiaryBench?: Bench }
    const b: Bench = { on: true, typing: false, frames: [], longTasks: [], loafs: [], keys: [], events: [] }
    w.__apiaryBench = b
    let last = performance.now()
    const tick = (t: number): void => {
      b.frames.push(Math.round((t - last) * 10) / 10)
      last = t
      if (b.on) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) b.longTasks.push(Math.round(e.duration))
    }).observe({ type: 'longtask' })
    interface Loaf extends PerformanceEntry {
      blockingDuration: number
      scripts: { invoker: string; sourceURL: string; sourceFunctionName: string; duration: number }[]
    }
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as Loaf[]) {
        b.loafs.push({
          duration: Math.round(e.duration),
          blocking: Math.round(e.blockingDuration),
          scripts: e.scripts.map((s) => ({
            invoker: s.invoker, source: s.sourceURL.split('/').pop() ?? '', fn: s.sourceFunctionName, duration: Math.round(s.duration),
          })),
        })
      }
    }).observe({ type: 'long-animation-frame' })
    interface EventEntry extends PerformanceEntry { processingStart: number; processingEnd: number }
    new PerformanceObserver((list) => {
      if (!b.typing) return
      for (const e of list.getEntries() as EventEntry[]) {
        if (!/^key|^input|^beforeinput/.test(e.name)) continue
        b.events.push({
          name: e.name,
          duration: e.duration,
          inputDelay: Math.round(e.processingStart - e.startTime),
          processing: Math.round(e.processingEnd - e.processingStart),
        })
      }
    }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit)
    document.addEventListener('keydown', (e) => {
      if (!b.typing) return
      // The wall clock now, less the event's age: `timeOrigin` is fixed at page load, and a wall
      // clock adjusted mid-run (seen in a container: 25 ms) would skew every later key against the
      // harness's `Date.now()`.
      const age = performance.now() - e.timeStamp
      const key = { t0Epoch: Date.now() - age, handledMs: age, paintMs: 0 }
      b.keys.push(key)
      const t0 = e.timeStamp
      // After the next frame's rendering work: the frame that shows the character.
      requestAnimationFrame(() => {
        const ch = new MessageChannel()
        ch.port1.onmessage = () => { key.paintMs = performance.now() - t0 }
        ch.port2.postMessage(0)
      })
    }, true)
  })
}

export async function setTyping(page: Page, on: boolean): Promise<void> {
  await page.evaluate((v) => {
    const b = (window as Window & { __apiaryBench?: { typing: boolean } }).__apiaryBench
    if (b !== undefined) b.typing = v
  }, on)
}

export async function collectRenderer(app: ElectronApplication, page: Page, windowNumber: number): Promise<RendererData> {
  const data = await page.evaluate(() => {
    interface Bench { on: boolean; frames: number[]; longTasks: number[]; loafs: LoafSummary[]; keys: KeyTiming[]; events: RendererData['events'] }
    interface LoafSummary { duration: number; blocking: number; scripts: { invoker: string; source: string; fn: string; duration: number }[] }
    interface KeyTiming { t0Epoch: number; handledMs: number; paintMs: number }
    const b = (window as Window & { __apiaryBench?: Bench }).__apiaryBench
    if (b === undefined) throw new Error('renderer probe not installed')
    b.on = false
    return { frames: b.frames.slice(1), longTasks: b.longTasks, loafs: b.loafs, keys: b.keys, events: b.events }
  })
  // The JS heap alone, so a growing renderer can be told apart from DOM, layout and image memory.
  const cdp = await app.context().newCDPSession(page)
  const heap = await cdp.send('Runtime.getHeapUsage')
  await cdp.detach()
  return { window: windowNumber, ...data, heapMb: Math.round(heap.usedSize / 1048576) }
}

function cpuSecondsMac(time: string): number {
  // `ps -o time`: [[dd-]hh:]mm:ss.cc
  const [days, rest] = time.includes('-') ? time.split('-') : ['0', time]
  const parts = rest.split(':').map(Number)
  let s = 0
  for (const p of parts) s = s * 60 + p
  return Number(days) * 86400 + s
}

interface RawProc { pid: number; ppid: number; rssKb: number; cpuSec: number; comm: string }

function listProcs(): RawProc[] {
  if (process.platform === 'linux') {
    const out: RawProc[] = []
    const tick = 100
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue
      try {
        const stat = readFileSync(`/proc/${d}/stat`, 'utf8')
        const close = stat.lastIndexOf(')')
        const comm = stat.slice(stat.indexOf('(') + 1, close)
        const f = stat.slice(close + 2).split(' ')
        out.push({ pid: Number(d), ppid: Number(f[1]), cpuSec: (Number(f[11]) + Number(f[12])) / tick, rssKb: Number(f[21]) * 4, comm })
      } catch { /* exited while listing */ }
    }
    return out
  }
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,time=,comm='], { encoding: 'utf8' }).split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    return m === null ? [] : [{ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cpuSec: cpuSecondsMac(m[4]), comm: m[5] }]
  })
}

function kindOf(comm: string): string {
  const name = basename(comm).toLowerCase()
  if (name.includes('electron') || name.includes('apiary')) return 'electron'
  if (name === 'claude' || name.startsWith('claude')) return 'claude'
  if (/^-?(zsh|bash|sh|fish|dash)$/.test(name)) return 'shell'
  if (name === 'node') return 'node'
  if (name === 'git') return 'git'
  return name
}

/** Samples every process under `rootPid` (not the Electron ones `getAppMetrics` already covers) until stopped. */
export function startChildSampler(rootPid: number, intervalMs: number): { stop: () => ChildSample[] } {
  const samples: ChildSample[] = []
  let prev = new Map<number, { cpuSec: number; t: number }>()
  const sample = (): void => {
    const t = Date.now()
    const all = listProcs()
    const byParent = new Map<number, RawProc[]>()
    for (const p of all) byParent.set(p.ppid, [...(byParent.get(p.ppid) ?? []), p])
    const under: RawProc[] = []
    const queue = [rootPid]
    while (queue.length > 0) {
      for (const c of byParent.get(queue.shift() ?? -1) ?? []) { under.push(c); queue.push(c.pid) }
    }
    const next = new Map<number, { cpuSec: number; t: number }>()
    const procs = under.filter((p) => kindOf(p.comm) !== 'electron').map((p) => {
      next.set(p.pid, { cpuSec: p.cpuSec, t })
      const before = prev.get(p.pid)
      const cpu = before === undefined ? 0 : (100 * (p.cpuSec - before.cpuSec)) / ((t - before.t) / 1000)
      return { pid: p.pid, kind: kindOf(p.comm), cpu: Math.max(0, Math.round(cpu * 10) / 10), rssKb: p.rssKb }
    })
    prev = next
    samples.push({ t, procs })
  }
  sample()
  const timer = setInterval(sample, intervalMs)
  return { stop: () => { clearInterval(timer); return samples.slice(1) } }
}

export interface RendererMemSample { t: number; window: number; jsHeapMb: number; domNodes: number; listeners: number }

/** Samples each window's JS heap and DOM node count, once per `wait`, to tell DOM growth from retained JS. */
export function startRendererMemSampler(app: ElectronApplication, pages: { page: Page; number: number }[], wait: () => Promise<void>): { stop: () => Promise<RendererMemSample[]> } {
  const samples: RendererMemSample[] = []
  let running = true
  const loop = (async () => {
    const sessions = await Promise.all(pages.map(async ({ page, number }) => ({ number, cdp: await app.context().newCDPSession(page) })))
    while (running) {
      for (const { number, cdp } of sessions) {
        try {
          const heap = await cdp.send('Runtime.getHeapUsage')
          const dom = await cdp.send('Memory.getDOMCounters')
          samples.push({ t: Date.now(), window: number, jsHeapMb: Math.round(heap.usedSize / 1048576), domNodes: dom.nodes, listeners: dom.jsEventListeners })
        } catch { /* a window closing mid-sample */ }
      }
      await wait()
    }
    for (const { cdp } of sessions) await cdp.detach().catch(() => {})
  })()
  return { stop: async () => { running = false; await loop; return samples } }
}

/** A CPU profile of one window's renderer over `ms`, written as a `.cpuprofile` (open it in DevTools or speedscope). */
export async function profileRenderer(app: ElectronApplication, page: Page, hold: () => Promise<void>, file: string): Promise<void> {
  const cdp = await app.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
  await cdp.send('Profiler.start')
  await hold()
  const { profile } = await cdp.send('Profiler.stop')
  writeFileSync(file, JSON.stringify(profile))
  await cdp.detach()
}

/** A CPU profile of the main process while `hold` runs, through Node's inspector inside it. */
export async function profileMain(app: ElectronApplication, hold: () => Promise<void>, file: string): Promise<void> {
  await app.evaluate(async () => {
    interface Holder { __apiaryProfiler?: { post: (method: string, params?: object) => Promise<unknown>; session: { disconnect: () => void } } }
    const inspector = process.getBuiltinModule('node:inspector')
    const session = new inspector.Session()
    session.connect()
    const post = (method: string, params?: object): Promise<unknown> => new Promise((resolve, reject) => {
      session.post(method, params ?? {}, (err, res) => { if (err) reject(err); else resolve(res) })
    })
    ;(globalThis as Holder).__apiaryProfiler = { post, session }
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 500 })
    await post('Profiler.start')
  })
  await hold()
  const profile = await app.evaluate(async () => {
    interface Holder { __apiaryProfiler?: { post: (method: string, params?: object) => Promise<unknown>; session: { disconnect: () => void } } }
    const p = (globalThis as Holder).__apiaryProfiler
    if (p === undefined) throw new Error('main profiler not started')
    const res = await p.post('Profiler.stop') as { profile: unknown }
    p.session.disconnect()
    return JSON.stringify(res.profile)
  })
  writeFileSync(file, profile)
}

/** A Chromium trace of every process while `hold` runs (open it in https://ui.perfetto.dev, or `scripts/bench/trace-summary.mjs`). */
export async function traceApp(app: ElectronApplication, hold: () => Promise<void>, file: string): Promise<void> {
  await app.evaluate(async ({ contentTracing }) => {
    await contentTracing.startRecording({
      included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'toplevel', 'ipc', 'input', 'latencyInfo', 'gpu', 'viz', 'cc', 'blink'],
    })
  })
  await hold()
  await app.evaluate(async ({ contentTracing }, out) => { await contentTracing.stopRecording(out) }, file)
}

interface ProfileNode { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }

/** Self time by function over a `.cpuprofile`, heaviest first: the first thing to read in one. */
export function topSelfTime(file: string, limit = 25): { fn: string; where: string; ms: number; pct: number }[] {
  const p = JSON.parse(readFileSync(file, 'utf8')) as { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] }
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const self = new Map<number, number>()
  p.samples.forEach((id, i) => { self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)) })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  const byFn = new Map<string, { fn: string; where: string; us: number }>()
  for (const [id, us] of self) {
    const n = byId.get(id)
    if (n === undefined) continue
    const where = `${n.callFrame.url.split('/').slice(-2).join('/')}:${String(n.callFrame.lineNumber + 1)}`
    const fn = n.callFrame.functionName || '(anonymous)'
    const key = `${fn}@${where}`
    const e = byFn.get(key) ?? { fn, where, us: 0 }
    e.us += us
    byFn.set(key, e)
  }
  return [...byFn.values()].sort((a, b) => b.us - a.us).slice(0, limit)
    .map((e) => ({ fn: e.fn, where: e.where, ms: Math.round(e.us / 1000), pct: Math.round((1000 * e.us) / total) / 10 }))
}
