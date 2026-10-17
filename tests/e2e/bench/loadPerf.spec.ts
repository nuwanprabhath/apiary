import { test, expect, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir, tmpdir, cpus, totalmem, platform, release } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { launchApiary, type Harness } from '../helpers'
import {
  startMainSampler, collectMain, installRendererProbe, setTyping, collectRenderer, startChildSampler,
  profileRenderer, profileMain, traceApp, topSelfTime, startRendererMemSampler, type RendererData,
} from './loadProbes'
import { summarise } from './loadSummary'
import { STARTER_PET } from '@shared/pets/builtins'

/**
 * Apiary under a realistic load: N chat sessions running at once, spread over M windows, while a
 * person types in a message box. Records CPU and memory of every process, the main event loop's
 * delay, frame times and the delay from each key press to the frame that shows it.
 *
 * Opt-in: `playwright.config.ts` ignores it unless APIARY_BENCH_LOAD=1; `npm run bench:load` builds and runs it. Settings, all optional:
 * - APIARY_BENCH_CLAUDE: `haiku` (default: real `claude --model haiku`, spends tokens), `record`
 *   (the same, and records every session to APIARY_BENCH_RECORD), `replay` (plays recordings from
 *   APIARY_BENCH_REPLAY back at their recorded pace; no tokens, no login).
 * - APIARY_BENCH_SESSIONS (6), APIARY_BENCH_WINDOWS (2), APIARY_BENCH_AGENTS (all sessions; 0 is an
 *   idle baseline), APIARY_BENCH_SECONDS (120), APIARY_BENCH_TYPING (1).
 * - APIARY_BENCH_THEME: a theme id (default `builtin:glass`, the heaviest to draw) or `original`.
 * - APIARY_BENCH_PETS: how many pets are out (0 to 3), spread over the windows.
 * - APIARY_BENCH_NO_ANIMATIONS=1: CSS animations and transitions off (what spinners cost to composite);
 *   APIARY_BENCH_STEPPED_ANIMATIONS=1 keeps them but steps them (`steps(4)` per cycle).
 * - APIARY_BENCH_GPU=off: software compositing (`--disable-gpu`), like a Linux box without GPU acceleration.
 * - APIARY_BENCH_PROFILE=1: CPU profiles of main and the first window for the last 15 s (those
 *   seconds are left out of the numbers); APIARY_BENCH_TRACE=1: a Chromium trace for Perfetto.
 * - APIARY_BENCH_LABEL, APIARY_BENCH_OUT: where results go (default `bench-results/<label>`, gitignored).
 * - APIARY_BENCH_ELECTRON_ARGS: extra Chromium switches, space-separated (`--no-sandbox` in a container).
 * - APIARY_BENCH_HEADLESS=1: keep windows off-screen (they never present a frame, so paint costs differ).
 */
const env = (name: string, fallback: string): string => process.env[name] ?? fallback
const CLAUDE = env('APIARY_BENCH_CLAUDE', 'haiku') as 'haiku' | 'record' | 'replay'
const SESSIONS = Number(env('APIARY_BENCH_SESSIONS', '6'))
const WINDOWS = Number(env('APIARY_BENCH_WINDOWS', '2'))
const AGENTS = Number(env('APIARY_BENCH_AGENTS', String(SESSIONS)))
const SECONDS = Number(env('APIARY_BENCH_SECONDS', '120'))
const TYPING = env('APIARY_BENCH_TYPING', '1') === '1'
const SOFTWARE = env('APIARY_BENCH_GPU', 'on') === 'off'
const PROFILE = env('APIARY_BENCH_PROFILE', '0') === '1'
const TRACE = env('APIARY_BENCH_TRACE', '0') === '1'
const LABEL = env('APIARY_BENCH_LABEL', `${platform()}-${CLAUDE}-${String(SESSIONS)}s${String(WINDOWS)}w-a${String(AGENTS)}${SOFTWARE ? '-nogpu' : ''}-${env('APIARY_BENCH_THEME', 'builtin:glass').replace('builtin:', '')}${env('APIARY_BENCH_PETS', '0') === '0' ? '' : `-pets${env('APIARY_BENCH_PETS', '0')}`}`)
// Not under test-results/: Playwright empties that folder at the start of every run.
const OUT = resolve(env('APIARY_BENCH_OUT', join('bench-results', LABEL)))
const PROFILE_MS = 15_000
/** The heaviest built-in look to draw, and the one the maintainer uses. `original` for the plain one. */
const THEME = env('APIARY_BENCH_THEME', 'builtin:glass')
const PETS = Number(env('APIARY_BENCH_PETS', '0'))
/** Switch CSS animations and transitions off, to measure what the spinners and working lines cost to composite. */
const NO_ANIMATIONS = env('APIARY_BENCH_NO_ANIMATIONS', '0') === '1'
/** Keep the animations but step them (a few changes a second instead of 60), to see whether that is enough. */
const STEPPED_ANIMATIONS = env('APIARY_BENCH_STEPPED_ANIMATIONS', '0') === '1'

const FIXTURES = fileURLToPath(new URL('../../fixtures/bench/', import.meta.url))
const REPO_SHARED = fileURLToPath(new URL('../../../src/shared/', import.meta.url))
const CLAUDE_ROOT = join(homedir(), '.claude')
const run = promisify(execFile)

const PROMPT = 'Go through the .ts files under ./src one at a time, in alphabetical order. Read each one with the Read tool, then write two or three paragraphs about what it does, with a short excerpt in a fenced code block. Do not create or edit any file and do not ask questions. Cover at least 30 files.'
const CONTINUE = 'Carry on with the next files you have not covered yet, in the same way.'
const SENTENCE = 'the quick brown fox jumps over the lazy dog while six agents write '

// eslint-disable-next-line playwright/no-wait-for-timeout -- paces typing at a person's speed and spaces the samples of a rate measured over time; there is no condition to wait on
const pause = (page: Page, ms: number): Promise<void> => page.waitForTimeout(ms)

const PRESET: Record<number, string> = { 1: 'single', 2: 'halves-h', 3: 'thirds-h', 4: 'grid' }

/** `session-layout.json` with the sessions dealt round-robin over the windows, one pane each. */
function layoutFile(ids: string[]): string {
  const perWindow = Array.from({ length: WINDOWS }, (_, w) => ids.filter((_, i) => i % WINDOWS === w))
  return JSON.stringify({
    version: 1,
    windows: perWindow.map((sessions, w) => ({
      number: w + 1,
      bounds: { x: 40 + w * 60, y: 40 + w * 40, width: 1600, height: 1000 },
      layout: {
        preset: PRESET[sessions.length] ?? 'grid',
        panes: sessions.map((id, p) => ({
          id: `bench-${String(w)}-${String(p)}`,
          tabs: [{ key: id, view: 'transcript', shells: [], activeShell: null }],
          activeTab: id,
        })),
      },
      live: [],
      hasLayout: true,
    })),
  })
}

const PET_COLORS = ['#e8590c', '#1c7ed6', '#2b8a3e']

/** `pets.json` with PETS starter pets out, dealt over the windows. */
function petsFile(): string {
  return JSON.stringify({
    version: 1,
    enabled: PETS > 0,
    pets: Array.from({ length: PETS }, (_, i) => ({
      id: `bench-pet-${String(i)}`,
      spec: { ...STARTER_PET, name: `Bench ${String(i)}`, body: { ...STARTER_PET.body, color: PET_COLORS[i % PET_COLORS.length] } },
      model: 'haiku', size: 64, active: true, place: null, window: (i % WINDOWS) + 1, createdAt: Date.now(), voicedAt: Date.now(),
    })),
  })
}

interface Lab { ids: string[]; cleanup: () => void }

/** Real sessions in a throwaway folder (a copy of `src/shared` for Claude to read), started outside the app. */
async function realLab(): Promise<Lab & { dir: string }> {
  const dir = join(tmpdir(), 'apiary-bench-lab')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  cpSync(REPO_SHARED, join(dir, 'src'), { recursive: true })
  await run('git', ['init', '-q', '-b', 'main', dir])
  const ids = await Promise.all(Array.from({ length: SESSIONS }, async (_, i) => {
    const { stdout } = await run('claude', ['-p', '--model', 'haiku', '--output-format', 'json', `Reply with just the words: bench seed ${String(i)}`], { cwd: dir })
    return (JSON.parse(stdout) as { session_id: string }).session_id
  }))
  const projectDirs = (): string[] => readdirSync(join(CLAUDE_ROOT, 'projects')).filter((d) => d.endsWith('apiary-bench-lab')).map((d) => join(CLAUDE_ROOT, 'projects', d))
  return { dir, ids, cleanup: () => { for (const d of projectDirs()) rmSync(d, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }) } }
}

function claudeBinFor(dir: string): string {
  if (CLAUDE === 'replay') return join(FIXTURES, 'replay-claude-chat.mjs')
  if (CLAUDE === 'record') return join(FIXTURES, 'record-claude.mjs')
  const script = join(dir, 'claude-haiku.sh')
  writeFileSync(script, '#!/bin/sh\nexec claude --model haiku "$@"\n')
  chmodSync(script, 0o755)
  return script
}

async function windowPages(h: Harness): Promise<{ page: Page; number: number }[]> {
  await expect.poll(() => h.app.windows().length, { timeout: 30_000 }).toBe(WINDOWS)
  const pages = h.app.windows().map((page) => ({ page, number: Number(new URL(page.url()).searchParams.get('w') ?? '0') }))
  for (const { page } of pages) await page.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
  return pages.sort((a, b) => a.number - b.number)
}

async function keepAgentsBusy(page: Page, ids: string[], until: () => boolean): Promise<number> {
  let resent = 0
  while (!until()) {
    for (const id of ids) {
      const status = await page.evaluate(async (s) => (await window.apiary.chatState(s as never))?.status ?? 'none', id)
      if (status === 'idle') { await page.evaluate(async ([s, text]) => { await window.apiary.chatSend(s as never, text) }, [id, CONTINUE] as const); resent += 1 }
    }
    await pause(page, 3000)
  }
  return resent
}

/** Types SENTENCE into the first message box of each window in turn, at about 12 characters a second. */
async function typeUntil(pages: Page[], until: () => boolean): Promise<Map<Page, number[]>> {
  const sent = new Map<Page, number[]>(pages.map((p) => [p, []]))
  for (let round = 0; !until(); round += 1) {
    const page = pages[round % pages.length]
    const box = page.getByTestId('composer-input').first()
    await box.click()
    await setTyping(page, true)
    for (const ch of SENTENCE) {
      if (until()) break
      const at = Date.now()
      sent.get(page)?.push(at)
      await page.keyboard.press(ch === ' ' ? 'Space' : ch)
      await pause(page, Math.max(0, 80 - (Date.now() - at)))
    }
    await setTyping(page, false)
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await pause(page, 800)
  }
  return sent
}

test('Apiary under N agent sessions in M windows', async () => {
  test.setTimeout((SECONDS + 300) * 1000)
  if (process.env.APIARY_BENCH_HEADLESS !== '1') process.env.APIARY_HEADED = '1'
  process.env.APIARY_E2E_NO_TRACE = '1'
  mkdirSync(OUT, { recursive: true })

  let lab: Lab & { dir: string }
  let configRoot: string | undefined
  const fixtureIds = Array.from({ length: SESSIONS }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`)
  if (CLAUDE === 'replay') {
    if (!existsSync(env('APIARY_BENCH_REPLAY', ''))) throw new Error('APIARY_BENCH_CLAUDE=replay needs APIARY_BENCH_REPLAY: a recording or a folder of them (make some with APIARY_BENCH_CLAUDE=record)')
    lab = { dir: tmpdir(), ids: fixtureIds, cleanup: () => {} }
  } else {
    lab = await realLab()
    configRoot = CLAUDE_ROOT
  }

  const h = await launchApiary({
    configRoot,
    claudeBin: claudeBinFor(lab.dir),
    electronArgs: [...(SOFTWARE ? ['--disable-gpu'] : []), ...env('APIARY_BENCH_ELECTRON_ARGS', '').split(' ').filter(Boolean)],
    settings: { transcriptChat: true },
    userDataFiles: { 'session-layout.json': layoutFile(lab.ids), ...(PETS > 0 ? { 'pets.json': petsFile() } : {}) },
    extraSessions: CLAUDE === 'replay'
      ? fixtureIds.map((sessionId, i) => ({ slug: `-bench-${String(i)}`, sessionId, title: `Bench session ${String(i)}` }))
      : undefined,
  })
  const benchStartedAt = Date.now()
  try {
    await h.page.evaluate(async ([ids, theme]) => {
      await window.apiary.importSessions(ids as never, [])
      await window.apiary.themeApply(theme === 'original' ? null : theme)
    }, [lab.ids, THEME] as const)
    const pages = await windowPages(h)
    // The windows restored their tabs before the sessions were imported, so their panes are empty:
    // a reload restores them again against a tree that has the sessions.
    for (const { page } of pages) {
      await page.reload()
      await page.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
      await expect(page.getByTestId('session-column')).toHaveCount(Math.ceil(SESSIONS / WINDOWS))
      await expect(page.getByTestId('composer-input')).toHaveCount(Math.ceil(SESSIONS / WINDOWS))
    }

    // Start the agents from the panes' own message boxes, as a person would.
    const agentIds = lab.ids.slice(0, AGENTS)
    for (const { page } of pages) {
      const columns = page.getByTestId('session-column')
      for (let i = 0; i < await columns.count(); i += 1) {
        const index = lab.ids.findIndex((_, k) => k % WINDOWS === pages.findIndex((p) => p.page === page) && Math.floor(k / WINDOWS) === i)
        if (index < 0 || index >= AGENTS) continue
        const box = columns.nth(i).getByTestId('composer-input')
        await box.fill(PROMPT)
        await box.press('Enter')
      }
    }
    // All but one busy (one may already be between turns); nothing to wait for with no agents.
    await expect.poll(() => h.page.evaluate(async (ids) => {
      const states = await Promise.all(ids.map((s) => window.apiary.chatState(s as never)))
      return states.filter((s) => s?.status === 'busy').length
    }, agentIds), { timeout: 90_000 }).toBeGreaterThanOrEqual(Math.max(0, AGENTS - 1))
    // Let the first replies start streaming before measuring.
    await pause(h.page, 8000)

    if (NO_ANIMATIONS || STEPPED_ANIMATIONS) {
      const css = NO_ANIMATIONS
        ? '*, *::before, *::after { animation: none !important; transition: none !important; }'
        : '*, *::before, *::after { animation-timing-function: steps(4, jump-none) !important; }'
      for (const { page } of pages) await page.addStyleTag({ content: css })
    }
    // What was on screen while measuring, to check a run did what it says (pets out, replies streaming).
    for (const { page, number } of pages) await page.screenshot({ path: join(OUT, `window-${String(number)}.png`) })
    for (const { page } of pages) await installRendererProbe(page)
    await startMainSampler(h.app, 1000)
    const children = startChildSampler(h.app.process().pid ?? 0, 1000)
    const rendererMem = startRendererMemSampler(h.app, pages, () => pause(h.page, 15_000))
    const measureStart = Date.now()
    const measureEnd = measureStart + SECONDS * 1000
    const profileFrom = PROFILE || TRACE ? measureEnd : Infinity
    const done = (): boolean => Date.now() >= measureEnd

    const [resent, sent] = await Promise.all([
      AGENTS > 0 ? keepAgentsBusy(h.page, agentIds, () => Date.now() >= measureEnd + (PROFILE || TRACE ? PROFILE_MS : 0)) : Promise.resolve(0),
      TYPING ? typeUntil(pages.map((p) => p.page), done) : Promise.resolve(new Map<Page, number[]>()),
      (async () => {
        while (!done()) await pause(h.page, 500)
        const work: Promise<void>[] = []
        const hold = (): Promise<void> => pause(h.page, PROFILE_MS)
        if (PROFILE) {
          work.push(profileMain(h.app, hold, join(OUT, 'main.cpuprofile')))
          work.push(profileRenderer(h.app, pages[0].page, hold, join(OUT, 'renderer-w1.cpuprofile')))
        }
        if (TRACE) work.push(traceApp(h.app, hold, join(OUT, 'trace.json')))
        await Promise.all(work)
      })(),
    ])

    const childSamples = children.stop()
    const rendererMemSamples = await rendererMem.stop()
    const main = await collectMain(h.app)
    const renderers: RendererData[] = []
    for (const { page, number } of pages) renderers.push(await collectRenderer(h.app, page, number))
    const keySends = pages.map(({ page, number }) => ({ window: number, sent: sent.get(page) ?? [] }))

    // Stop the agents first: tokens are spent for as long as they run.
    await h.page.evaluate(async (ids) => { await Promise.all(ids.map((s) => window.apiary.chatStop(s as never))) }, agentIds)

    const config = {
      label: LABEL, theme: THEME, pets: PETS, noAnimations: NO_ANIMATIONS, steppedAnimations: STEPPED_ANIMATIONS, claude: CLAUDE, sessions: SESSIONS, windows: WINDOWS, agents: AGENTS, seconds: SECONDS, typing: TYPING,
      software: SOFTWARE, headless: process.env.APIARY_BENCH_HEADLESS === '1', resent,
      machine: { platform: platform(), release: release(), cpus: cpus().length, cpuModel: cpus()[0]?.model ?? '', memGb: Math.round(totalmem() / 2 ** 30) },
      startedAt: new Date(benchStartedAt).toISOString(),
    }
    const summary = summarise({ config, main, childSamples, renderers, keySends, until: profileFrom })
    const profiles = PROFILE
      ? { main: topSelfTime(join(OUT, 'main.cpuprofile')), renderer: topSelfTime(join(OUT, 'renderer-w1.cpuprofile')) }
      : null
    writeFileSync(join(OUT, 'result.json'), JSON.stringify({ config, summary, profiles, main, childSamples, renderers, keySends, rendererMemSamples }, null, 1))
    writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ config, summary, profiles }, null, 2))
  } catch (e) {
    // What each window showed, for a run that went wrong.
    for (const [i, page] of h.app.windows().entries()) await page.screenshot({ path: join(OUT, `failure-${String(i + 1)}.png`) }).catch(() => {})
    throw e
  } finally {
    await h.close()
    lab.cleanup()
  }
})
