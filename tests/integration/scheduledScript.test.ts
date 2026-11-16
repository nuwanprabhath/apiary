import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { ScheduledJobs, type JobLaunch } from '../../src/main/schedule/scheduledJobs'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

/**
 * The real `apiary-scheduled` script, run as the OS job runs it (`/bin/sh <script> <id>`), against a
 * stand-in `claude` that records its folder, its arguments and its account environment.
 */
describe('the scheduled-message script', () => {
  let userData: string
  let record: string
  let jobs: ScheduledJobs
  let launch: JobLaunch

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'sched-'))
    userData = join(root, 'Apiary Data')
    const cwd = join(root, "the project's folder")
    mkdirSync(cwd, { recursive: true })
    record = join(root, 'claude-calls.txt')
    const claude = join(root, 'claude')
    writeFileSync(claude, `#!/bin/sh\n{ echo "cwd=$(pwd)"; echo "config=$CLAUDE_CONFIG_DIR"; for a in "$@"; do echo "arg=$a"; done; } >> '${record}'\necho replied\n`)
    chmodSync(claude, 0o755)
    jobs = new ScheduledJobs(userData)
    launch = {
      sessionId: '11111111-1111-1111-1111-111111111111', cwd, text: "continue — it's $HOME `x`", at: Date.now() - 1000,
      claudeBin: claude, shell: '/bin/sh', env: { CLAUDE_CONFIG_DIR: join(root, 'accounts', 'work') }, jobKind: 'none',
    }
  })

  const run = (): void => { execFileSync('/bin/sh', [jobs.script, ID], { stdio: 'ignore', timeout: 30_000 }) }

  it('sends nothing while Apiary is running', () => {
    // This test's own process stands in for Apiary: its command line names the apiary checkout.
    jobs.install(process.pid)
    jobs.write(ID, launch)
    run()
    expect(existsSync(record)).toBe(false)
    expect(jobs.result(ID)).toBeNull()
  })

  it('with Apiary closed, resumes the session in its folder under its account with the text after --, and records the result', () => {
    jobs.install(process.pid)
    jobs.uninstall()
    jobs.write(ID, launch)
    run()
    const lines = readFileSync(record, 'utf8').trim().split('\n')
    expect(lines).toEqual([
      `cwd=${launch.cwd}`,
      `config=${launch.env.CLAUDE_CONFIG_DIR ?? ''}`,
      'arg=--resume', `arg=${launch.sessionId}`, 'arg=-p', 'arg=--', `arg=${launch.text}`,
    ])
    const result = jobs.result(ID)
    expect(result).toMatchObject({ code: 0, logTail: 'replied' })
    expect(Math.abs((result?.at ?? 0) - Date.now())).toBeLessThan(60_000)
    expect(existsSync(join(userData, 'scheduled', `${ID}.vars`))).toBe(false)
    expect(jobs.runningSince(ID)).toBeNull()
  })

  it('a stale pid (Apiary crashed) counts as closed', () => {
    jobs.install(process.pid)
    writeFileSync(join(userData, 'apiary.pid'), '999999\n')
    jobs.write(ID, { ...launch, model: 'claude-haiku-5-5' })
    run()
    expect(readFileSync(record, 'utf8')).toContain('arg=--model\narg=claude-haiku-5-5\n')
  })

  it('a missing folder is a failed send with the reason in its log', () => {
    jobs.install(process.pid)
    jobs.uninstall()
    jobs.write(ID, { ...launch, cwd: join(userData, 'gone') })
    run()
    expect(existsSync(record)).toBe(false)
    expect(jobs.result(ID)?.code).toBe(1)
    expect(jobs.result(ID)?.logTail).toContain('folder is gone')
  })

  it('a job whose schedule was cancelled does nothing', () => {
    jobs.install(process.pid)
    jobs.uninstall()
    run()
    expect(existsSync(record)).toBe(false)
  })
})
