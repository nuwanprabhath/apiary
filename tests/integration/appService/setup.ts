import { mkdtempSync, rmSync, mkdirSync, realpathSync } from 'node:fs'
import { git as sharedGit, initRepo } from '../../fixtures/gitRepo'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { AppService } from '../../../src/main/appService'
import { log } from '../../../src/main/log/logger'

/**
 * Shared fixture for every appService/*.test.ts file (TEST-19): a throwaway `~/.claude` home, a
 * throwaway git-free working directory, and a fresh `AppService` over both. Split out of what used
 * to be one 1400-line appService.test.ts so each topic file stays focused, without duplicating the
 * setup/teardown by hand in all fourteen of them.
 */
export interface ServiceFixture {
  home: string
  workdir: string
  service: AppService
}

export function createServiceFixture(): ServiceFixture {
  const home = mkdtempSync(join(tmpdir(), 'apiary-home-'))
  const workdir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-')))
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
  const service = new AppService({
    configRoot: join(home, '.claude'),
    dbPath: join(home, 'apiary.db'),
    detectLive: async () => new Map(),
  })
  return { home, workdir, service }
}

export async function teardownServiceFixture(fixture: ServiceFixture): Promise<void> {
  await fixture.service.dispose()
  rmSync(fixture.home, { recursive: true, force: true })
  rmSync(fixture.workdir, { recursive: true, force: true })
}

/** Trimmed output, unlike the shared builder's raw `git` (callers here compare exact strings). */
export function git(cwd: string, ...args: string[]): string {
  return sharedGit(cwd, ...args).trim()
}

export function makeGitWorkdir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-work-git-')))
  initRepo(dir, { readme: 'hi' })
  return dir
}

/** Captures the `{files, parsed, folders, gitSpawns, ms}` fields of every `refresh`/`pass` log
 *  line — the "measure before fixing" instrumentation MAIN-1 added to `runRefresh`. */
export function captureRefreshPass(): { calls: () => Record<string, unknown>[]; restore: () => void } {
  const seen: Record<string, unknown>[] = []
  const spy = vi.spyOn(log, 'info').mockImplementation((scope, message, fields) => {
    if (scope === 'refresh' && message === 'pass') seen.push(fields as Record<string, unknown>)
  })
  return { calls: () => seen, restore: () => spy.mockRestore() }
}
