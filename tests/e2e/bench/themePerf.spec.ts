import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { launchApiary, importAll, sidebarSession, type Harness } from '../helpers'

/**
 * How snappy each built-in theme feels, against Apiary's original look.
 *
 * Opt-in (APIARY_BENCH=1): it takes minutes and measures the machine it runs on. With
 * APIARY_BENCH_GPU=off the app runs with `--disable-gpu`, i.e. software compositing — close to a
 * Linux desktop or VM without GPU acceleration, where an expensive theme hurts most. That is
 * where Liquid Glass was reported to lag (hover highlights seconds behind the pointer).
 *
 * What is measured, per scenario, is what a person feels:
 * - input-to-screen time of every hover, click and key press (the Event Timing API: from the
 *   input until the frame showing its effect is presented — compositor and GPU included);
 * - frames longer than 50 ms while the scenario runs (visible stutter).
 *
 * A theme passes when it is no worse than the original by more than a small margin.
 */
// eslint-disable-next-line playwright/no-skipped-test -- opt-in benchmark: it takes minutes and measures the machine it runs on, so it must not run by default in CI or a normal test pass
test.skip(process.env.APIARY_BENCH !== '1', 'theme benchmark is opt-in: APIARY_BENCH=1')

const SOFTWARE = process.env.APIARY_BENCH_GPU === 'off'
const THEMES: Array<string | null> = (process.env.APIARY_BENCH_THEMES ?? 'original,builtin:matrix,builtin:neon,builtin:paper,builtin:glass')
  .split(',').map((t) => (t === 'original' ? null : t))
/** Each theme is measured this many times, interleaved, and the median taken: one run is noisy. */
const RUNS = Number(process.env.APIARY_BENCH_RUNS ?? '3')
const OUT = process.env.APIARY_BENCH_OUT ?? '/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/bench.json'

interface Sample { events: number[]; frames: number[] }
interface Metrics { inputP95: number; inputMax: number; slowInputs: number; longFrames: number; frameP95: number }

const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const metrics = (s: Sample): Metrics => ({
  inputP95: Math.round(pct(s.events, 0.95)),
  inputMax: Math.round(Math.max(0, ...s.events)),
  slowInputs: s.events.filter((d) => d > 100).length,
  longFrames: s.frames.filter((f) => f > 50).length,
  frameP95: Math.round(pct(s.frames, 0.95)),
})

async function record(page: Page, run: () => Promise<void>): Promise<Sample> {
  await page.evaluate(() => {
    const w = window as unknown as { bench: { on: boolean; frames: number[]; events: number[]; obs?: PerformanceObserver } }
    w.bench?.obs?.disconnect()
    w.bench = { on: true, frames: [], events: [] }
    let last = performance.now()
    const tick = (t: number): void => { w.bench.frames.push(t - last); last = t; if (w.bench.on) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    // Every event slower than 16 ms, input to presented frame.
    const obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) w.bench.events.push(e.duration) })
    obs.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit)
    w.bench.obs = obs
  })
  await run()
  // Let the last frames and event entries land.
  // eslint-disable-next-line playwright/no-wait-for-timeout -- draining the tail of async frame/event-timing entries that the observer above hasn't delivered yet; there is no UI condition to assert on instead
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const w = window as unknown as { bench: { on: boolean; frames: number[]; events: number[]; obs?: PerformanceObserver } }
    w.bench.on = false
    for (const e of w.bench.obs?.takeRecords() ?? []) w.bench.events.push(e.duration)
    return { events: w.bench.events, frames: w.bench.frames.slice(1) }
  })
}

// eslint-disable-next-line playwright/no-wait-for-timeout -- paces simulated hover/scroll/drag input at a real frame interval so the benchmark measures input-to-frame latency under realistic timing, not as fast as the driver can issue events
const pause = (page: Page, ms = 16): Promise<void> => page.waitForTimeout(ms)

const SCENARIOS: Record<string, (h: Harness) => Promise<void>> = {
  async 'hover the session list'(h) {
    const box = (await h.page.getByTestId('sidebar').boundingBox())!
    const x = box.x + box.width / 2
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i <= 40; i += 1) {
        const f = pass === 0 ? i / 40 : 1 - i / 40
        await h.page.mouse.move(x, box.y + 90 + f * (box.height - 120))
        await pause(h.page)
      }
    }
  },
  async 'scroll the session list'(h) {
    const box = (await h.page.getByTestId('sidebar').boundingBox())!
    await h.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 16; i += 1) { await h.page.mouse.wheel(0, i < 8 ? 120 : -120); await pause(h.page, 30) }
  },
  async 'fold and unfold a project'(h) {
    const toggle = h.page.getByTestId('project-toggle').nth(1)
    for (let i = 0; i < 6; i += 1) { await toggle.click(); await pause(h.page, 120) }
  },
  async 'drag the shell handle'(h) {
    const r = (await h.page.getByTestId('bottom-resizer').boundingBox())!
    const x = r.x + r.width / 2
    const y = r.y + r.height / 2
    await h.page.mouse.move(x, y)
    await h.page.mouse.down()
    for (let i = 0; i <= 30; i += 1) { await h.page.mouse.move(x, y - 120 * Math.sin((i / 30) * Math.PI)); await pause(h.page) }
    await h.page.mouse.up()
  },
  async 'type in the terminal'(h) {
    await h.page.getByTestId('terminal-shell').click()
    await h.page.keyboard.type('ls -la', { delay: 40 })
    await h.page.keyboard.press('Enter')
    await h.page.keyboard.type('echo done-typing', { delay: 40 })
    await h.page.keyboard.press('Enter')
    // A plain assertion, not `expect`, because this runs from a scenario function rather than
    // directly inside the `test()` block, and playwright/no-standalone-expect flags an `expect`
    // call there regardless of it running during the test.
    await h.page.getByTestId('terminal-shell').locator('.xterm-rows').filter({ hasText: 'done-typing' }).first().waitFor()
  },
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

test('every built-in theme is as snappy as the original look', async () => {
  test.setTimeout(RUNS * THEMES.length * 90_000)
  const runs: Record<string, Record<string, Metrics[]>> = {}
  for (let run = 0; run < RUNS; run += 1) for (const theme of THEMES) {
    const name = theme ?? 'original'
    const h = await launchApiary({
      electronArgs: SOFTWARE ? ['--disable-gpu'] : [],
      extraSessions: Array.from({ length: 60 }, (_, i) => ({
        slug: `-bench-${String(i % 6)}`,
        sessionId: `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`,
        title: `Benchmark session number ${String(i)}`,
      })),
    })
    try {
      await importAll(h.page)
      await h.page.getByTestId('sidebar-refresh').click()
      await h.page.evaluate((id) => window.apiary.themeApply(id), theme)
      await sidebarSession(h.page, 'Fix CSV export bug').click()
      await h.page.getByTestId('shell-toggle').click()
      await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
      // eslint-disable-next-line playwright/no-wait-for-timeout -- lets the theme's own transition/paint settle before measuring, so the first scenario's timings aren't skewed by the theme switch itself
      await h.page.waitForTimeout(1500)
      runs[name] ??= {}
      for (const [scenario, act] of Object.entries(SCENARIOS)) {
        ;(runs[name][scenario] ??= []).push(metrics(await record(h.page, () => act(h))))
      }
    } finally {
      await h.close()
    }
  }
  const results: Record<string, Record<string, Metrics>> = {}
  for (const [t, byScenario] of Object.entries(runs)) {
    results[t] = {}
    for (const [scenario, ms] of Object.entries(byScenario)) {
      results[t][scenario] = {
        inputP95: median(ms.map((m) => m.inputP95)), inputMax: median(ms.map((m) => m.inputMax)),
        slowInputs: median(ms.map((m) => m.slowInputs)), longFrames: median(ms.map((m) => m.longFrames)),
        frameP95: median(ms.map((m) => m.frameP95)),
      }
    }
  }

  writeFileSync(OUT, JSON.stringify({ software: SOFTWARE, results }, null, 2))
  const rows = Object.keys(SCENARIOS).flatMap((scenario) => Object.keys(results).map((t) => ({ scenario, theme: t, ...results[t][scenario] })))
  // eslint-disable-next-line no-console -- this benchmark's whole purpose is reporting its measured numbers to whoever ran it; also written to OUT above for machine reading
  console.table(rows)

  const base = results.original
  if (base === undefined) return
  const failures: string[] = []
  for (const [t, byScenario] of Object.entries(results)) {
    if (t === 'original') continue
    for (const [scenario, m] of Object.entries(byScenario)) {
      const b = base[scenario]
      // "As snappy as the original": input no more than a frame or two slower at p95, no input a
      // person would call laggy that the original does not also have, and no extra stutter.
      if (m.inputP95 > b.inputP95 + 33) failures.push(`${t} / ${scenario}: input p95 ${String(m.inputP95)} ms vs ${String(b.inputP95)} ms`)
      if (m.slowInputs > b.slowInputs + 1) failures.push(`${t} / ${scenario}: ${String(m.slowInputs)} inputs over 100 ms vs ${String(b.slowInputs)}`)
      if (m.longFrames > b.longFrames + 3) failures.push(`${t} / ${scenario}: ${String(m.longFrames)} frames over 50 ms vs ${String(b.longFrames)}`)
    }
  }
  expect(failures, failures.join('\n')).toEqual([])
})
