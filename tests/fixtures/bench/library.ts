import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { makeSession } from '../makeSession'
import { buildAppService } from '../buildService'

/**
 * The library-scale benchmark (`scripts/bench/libraryScale.mjs` bundles and runs this): a synthetic
 * library of `sessions` transcripts, the real session services around it, and timings of the
 * main-process paths whose cost grows with the library.
 */
export interface LibraryShape { sessions: number; seed?: number }

export interface Timing { median: number; worst: number; runs: number[] }

export interface LibrarySummary {
  label: string
  config: { sessions: number; folders: number; small: number; long: number; huge: number; bytes: number; node: string; platform: string }
  timings: Record<string, Timing>
  treeJsonBytes: number
}

const RUNS = 5

/** A small seeded generator, so two runs with the same size build the same library. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const uuidFor = (i: number): string => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`

/** The line count of session `i`: 95% between 50 and 500, 4% of 5,000, 1% of 50,000. */
function linesFor(i: number, next: () => number): number {
  if (i % 100 === 0) return 50_000
  if (i % 25 === 1) return 5_000
  return 50 + Math.floor(next() * 451)
}

interface Library { root: string; configRoot: string; projectsRoot: string; hugeFile: string; hugeId: string; appendFile: string; counts: LibrarySummary['config'] }

/** Writes the library under a fresh temp root. `makeSession` adds four lines around its pad turns. */
export function writeLibrary(shape: LibraryShape): Library {
  const root = join(tmpdir(), `apiary-bench-library-${process.pid}-${Date.now()}`)
  const configRoot = join(root, '.claude')
  const projectsRoot = join(configRoot, 'projects')
  const folders = Math.max(1, Math.ceil(shape.sessions / 20))
  const next = random(shape.seed ?? 1)
  const counts = { sessions: shape.sessions, folders, small: 0, long: 0, huge: 0, bytes: 0, node: process.version, platform: process.platform }
  let hugeFile = ''
  let hugeId = ''
  let appendFile = ''
  for (let i = 0; i < shape.sessions; i++) {
    const cwd = join(root, 'work', `project-${i % folders}`)
    mkdirSync(cwd, { recursive: true })
    const lines = linesFor(i, next)
    if (lines === 50_000) counts.huge++
    else if (lines === 5_000) counts.long++
    else counts.small++
    const sessionId = uuidFor(i)
    const file = makeSession(projectsRoot, cwd.replace(/[^a-zA-Z0-9]/g, '-'), {
      sessionId, cwd, title: `bench session ${i}`, firstPrompt: `task ${i}: refactor module ${i % 97}`, padTurns: lines - 4,
    })
    if (lines === 50_000 && hugeFile === '') { hugeFile = file; hugeId = sessionId }
    if (i === 2) appendFile = file
  }
  writeFileSync(join(root, 'shape.json'), JSON.stringify(counts))
  return { root, configRoot, projectsRoot, hugeFile, hugeId, appendFile: appendFile || hugeFile, counts }
}

let appended = 0
/** One more assistant line on `file`, shaped like the ones `makeSession` writes. */
function appendLine(file: string, sessionId: string): void {
  appended++
  appendFileSync(file, JSON.stringify({
    sessionId, cwd: '', isSidechain: false, version: '2.1.246', type: 'assistant', uuid: `bench-${appended}`,
    timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: `appended ${appended}` }] },
  }) + '\n')
}

async function time(runs: number, before: () => Promise<void> | void, body: () => Promise<unknown>): Promise<Timing> {
  const all: number[] = []
  for (let r = 0; r < runs; r++) {
    await before()
    const t0 = performance.now()
    await body()
    all.push(Math.round((performance.now() - t0) * 10) / 10)
  }
  const sorted = [...all].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)] ?? 0, worst: sorted[sorted.length - 1] ?? 0, runs: all }
}

/** Builds the library, times each path {@link RUNS} times, removes the library, and returns the numbers. */
export async function runLibraryBenchmark(label: string, shape: LibraryShape): Promise<LibrarySummary> {
  const lib = writeLibrary(shape)
  const timings: Record<string, Timing> = {}
  let treeJsonBytes = 0
  try {
    const hugeId = lib.hugeId || uuidFor(0)
    const appendId = lib.appendFile === lib.hugeFile ? hugeId : uuidFor(2)
    let service = buildAppService({ configRoot: lib.configRoot, dbPath: join(lib.root, `apiary-0.db`), detectLive: async () => new Map(), autoImportAll: true })
    let dbs = 0
    // A first pass is first only against an empty database, so each run gets a fresh one.
    timings.firstFullPass = await time(RUNS, async () => {
      await service.dispose()
      dbs++
      service = buildAppService({
        configRoot: lib.configRoot, dbPath: join(lib.root, `apiary-${dbs}.db`), searchDbPath: join(lib.root, `search-${dbs}.db`),
        detectLive: async () => new Map(), autoImportAll: true, searchChatContent: true,
      })
    }, () => service.refresh({ full: true }))
    await service.updateSearchIndex()
    timings.fullPassUnchanged = await time(RUNS, () => service.updateSearchIndex(), () => service.refresh({ full: true }))
    timings.scopedPassOneAppend = await time(RUNS, async () => {
      await service.updateSearchIndex()
      appendLine(lib.appendFile, appendId)
    }, () => service.refresh({ paths: [lib.appendFile] }))
    await service.updateSearchIndex()
    timings.tree = await time(RUNS, () => undefined, async () => {
      treeJsonBytes = Buffer.byteLength(JSON.stringify(await service.tree()))
    })
    // A refresh starts an index pass without awaiting it, and `update` returns at once while one runs;
    // `rebuild` waits for it and indexes everything, so the timed passes below run alone.
    await service.rebuildSearchIndex()
    timings.searchIndexUnchanged = await time(RUNS, () => undefined, () => service.updateSearchIndex())
    timings.searchIndexHugeAppend = await time(RUNS, () => appendLine(lib.hugeFile, hugeId), () => service.updateSearchIndex())
    timings.transcriptNewestPage = await time(RUNS, () => undefined, () => service.transcript(hugeId))
    timings.transcriptMiddlePage = await time(RUNS, () => undefined, () => service.transcript(hugeId, 25_000))
    await service.dispose()
  } finally {
    rmSync(lib.root, { recursive: true, force: true })
  }
  return { label, config: lib.counts, timings, treeJsonBytes }
}
