import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync, rmSync, readFileSync, readdirSync, existsSync, writeFileSync, utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '../../src/main/log/logger'

let dir: string
let logger: Logger

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-log-'))
  rmSync(dir, { recursive: true, force: true })
  logger = new Logger()
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const on = (over: Partial<Parameters<Logger['configure']>[0]> = {}): void =>
  logger.configure({ enabled: true, dir, retentionDays: 7, maxSizeMb: 20, ...over })

const lines = (): Record<string, unknown>[] =>
  readFileSync(join(dir, 'apiary.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)

describe('a logger that is switched off', () => {
  it('writes nothing, and does not even create the folder', () => {
    // Disabled has to mean disabled: a diagnostic feature that creates files by default is one
    // that records things nobody agreed to.
    logger.configure({ enabled: false, dir, retentionDays: 7, maxSizeMb: 20 })
    logger.info('update', 'checked')
    expect(existsSync(dir)).toBe(false)
  })

  it('reports itself as off', () => {
    logger.configure({ enabled: false, dir, retentionDays: 7, maxSizeMb: 20 })
    expect(logger.status().enabled).toBe(false)
  })
})

describe('a logger that is switched on', () => {
  it('writes one JSON object per line, with a timestamp, level and scope', () => {
    on()
    logger.info('update', 'download finished', { ms: 120 })

    const [entry] = lines()
    expect(entry.level).toBe('info')
    expect(entry.scope).toBe('update')
    expect(entry.msg).toBe('download finished')
    expect(entry.ms).toBe(120)
    expect(typeof entry.ts).toBe('string')
  })

  it('redacts every field on the way in, so a call site cannot forget to', () => {
    on({ home: '/Users/nuwan' })
    logger.info('git', 'checkout refused', {
      worktree: '/Users/nuwan/projects/p.worktrees/dev-1.0.12',
      token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    })

    const [entry] = lines()
    expect(entry.worktree).toBe('~/projects/p.worktrees/dev-1.0.12')
    expect(entry.token).toBe('[redacted-github-token]')
  })

  it('records several entries in order', () => {
    on()
    logger.warn('pty', 'first')
    logger.error('pty', 'second')
    expect(lines().map((l) => l.msg)).toEqual(['first', 'second'])
  })

  it('reports where the logs are and how much disk they take', () => {
    on()
    logger.info('update', 'x')
    const status = logger.status()
    expect(status.enabled).toBe(true)
    expect(status.dir).toBe(dir)
    expect(status.files).toBe(1)
    expect(status.bytes).toBeGreaterThan(0)
  })

  it('clears every log file when asked', () => {
    on()
    logger.info('update', 'x')
    logger.clear()
    expect(logger.status().files).toBe(0)
  })
})

describe('keeping the logs inside their limits', () => {
  it('rolls the active file aside once it is too big, and keeps writing', () => {
    // A 20MB budget rotates at 4MB and has room to keep what it rolls aside. (A budget so small
    // that the rotated file does not fit is the *other* rule, and it wins — see the pruning
    // tests, where the size budget beats retention.)
    on({ maxSizeMb: 20 })
    logger.info('pty', 'first line, in the file that will be rolled aside')
    // Grown directly rather than by logging megabytes a line at a time: what is being tested is
    // the decision to rotate, and writing them takes longer than every other test here together.
    writeFileSync(join(dir, 'apiary.log'), 'x'.repeat(5 * 1024 * 1024))
    on({ maxSizeMb: 20 })

    logger.info('pty', 'after rotation')

    const files = readdirSync(dir)
    expect(files.length).toBeGreaterThan(1)
    expect(files).toContain('apiary.log')
    // The newest line is in the *active* file, which is the point of rotating rather than
    // stopping: logging continues, and the history is beside it.
    expect(lines().at(-1)?.msg).toBe('after rotation')
    expect(files.filter((f) => f !== 'apiary.log')).toHaveLength(1)
  })

  it('deletes archived files older than the retention period on startup', () => {
    on()
    const stale = join(dir, 'apiary-2020-01-01T00-00-00-000Z.log')
    writeFileSync(stale, 'old\n')
    // Backdated well past the window: age is read from the file, not from its name.
    const old = (Date.now() - 400 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(stale, old, old)

    // Pruning happens when logging is configured, which is what a restart does.
    on()
    expect(existsSync(stale)).toBe(false)
  })

  it('never deletes the file it is writing to', () => {
    on({ retentionDays: 0 })
    logger.info('update', 'still here')
    expect(existsSync(join(dir, 'apiary.log'))).toBe(true)
    expect(lines().at(-1)?.msg).toBe('still here')
  })
})

describe('a logger that cannot write', () => {
  it('does not throw, so a broken log never breaks the app', () => {
    // A path that cannot be a directory: there is a file where the folder should go.
    const blocked = join(tmpdir(), `apiary-log-blocked-${String(Date.now())}`)
    writeFileSync(blocked, 'not a directory')
    try {
      logger.configure({ enabled: true, dir: join(blocked, 'logs'), retentionDays: 7, maxSizeMb: 20 })
      expect(() => logger.info('update', 'anything')).not.toThrow()
    } finally {
      rmSync(blocked, { force: true })
    }
  })
})
