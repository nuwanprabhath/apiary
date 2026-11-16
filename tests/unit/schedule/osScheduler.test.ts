import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atScheduler, atTime, firstAvailable, launchdPlist, launchdScheduler, onCalendar, systemdScheduler } from '../../../src/main/schedule/osScheduler'
import { jobVars } from '../../../src/main/schedule/scheduledJobs'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const SCRIPT = '/Users/me/Library/Application Support/Apiary/bin/apiary-scheduled'
// A local time, so the calendar fields read the same in any zone the test runs in.
const AT = new Date(2026, 10, 17, 15, 5, 30).getTime()

function recorder(fail: (file: string, args: string[]) => boolean = () => false) {
  const calls: string[][] = []
  const exec = async (file: string, args: string[]): Promise<string> => {
    calls.push([file, ...args])
    if (fail(file, args)) throw new Error(`${file} failed`)
    return ''
  }
  return { calls, exec }
}

describe('launchd', () => {
  it('writes a LaunchAgent for the minute and bootstraps it into the GUI domain; remove boots it out and deletes it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'launchd-'))
    const { calls, exec } = recorder()
    const os = launchdScheduler({ exec, script: SCRIPT, homeDir: home, uid: 501 })
    await os.register(ID, AT)
    const plist = join(home, 'Library', 'LaunchAgents', `com.apiary.scheduled.${ID}.plist`)
    const text = readFileSync(plist, 'utf8')
    expect(text).toContain(`<string>com.apiary.scheduled.${ID}</string>`)
    expect(text).toContain(`<string>/bin/sh</string><string>${SCRIPT}</string><string>${ID}</string>`)
    expect(text).toContain('<key>Month</key><integer>11</integer><key>Day</key><integer>17</integer><key>Hour</key><integer>15</integer><key>Minute</key><integer>5</integer>')
    expect(calls).toContainEqual(['launchctl', 'bootstrap', 'gui/501', plist])
    await os.remove(ID)
    expect(calls.at(-1)).toEqual(['launchctl', 'bootout', `gui/501/com.apiary.scheduled.${ID}`])
    expect(existsSync(plist)).toBe(false)
  })

  it('escapes the script path for XML', () => {
    expect(launchdPlist(ID, AT, '/a&b/<c>')).toContain('<string>/a&amp;b/&lt;c&gt;</string>')
  })
})

describe('systemd', () => {
  it('runs a transient user timer at the second, and stops it to remove', async () => {
    const { calls, exec } = recorder()
    const os = systemdScheduler({ exec, script: SCRIPT, homeDir: '/home/me' })
    await os.register(ID, AT)
    expect(onCalendar(AT)).toBe('2026-11-17 15:05:30')
    expect(calls.at(-1)).toEqual([
      'systemd-run', '--user', `--unit=apiary-scheduled-${ID}`, '--on-calendar=2026-11-17 15:05:30',
      '--timer-property=AccuracySec=1s', '--timer-property=Persistent=true', '/bin/sh', SCRIPT, ID,
    ])
    calls.length = 0
    await os.remove(ID)
    expect(calls[0]).toEqual(['systemctl', '--user', 'stop', `apiary-scheduled-${ID}.timer`])
  })

  it('is available only with a systemd user manager', async () => {
    expect(await systemdScheduler({ ...recorder(), script: SCRIPT, homeDir: '/' }).available()).toBe(true)
    expect(await systemdScheduler({ ...recorder(() => true), script: SCRIPT, homeDir: '/' }).available()).toBe(false)
  })
})

describe('at', () => {
  it('queues the script for the second, and finds the job again by its id to remove it', async () => {
    const inputs: Array<[string, string[], string]> = []
    const calls: string[][] = []
    const exec = async (file: string, args: string[]): Promise<string> => {
      calls.push([file, ...args])
      if (file === 'atq') return '7\tTue Nov 17 15:05:00 2026 a me\n8\tTue Nov 17 16:00:00 2026 a me\n'
      if (file === 'at' && args[1] === '7') return `#!/bin/sh\ncd /home/me\n/bin/sh '${SCRIPT}' ${ID}\n`
      return 'something else\n'
    }
    const os = atScheduler({ exec, runInput: async (file, args, input) => { inputs.push([file, args, input]) }, script: SCRIPT, homeDir: '/home/me' })
    await os.register(ID, AT)
    expect(atTime(AT)).toBe('202611171505.30')
    expect(inputs).toEqual([['at', ['-t', '202611171505.30'], `/bin/sh '${SCRIPT}' ${ID}\n`]])
    calls.length = 0
    await os.remove(ID)
    expect(calls.filter((c) => c[0] === 'atrm')).toEqual([['atrm', '7']])
  })
})

describe('firstAvailable', () => {
  it('uses systemd where it is, else at, else nothing', async () => {
    const systemd = { ...recorder(() => true), script: SCRIPT, homeDir: '/' }
    const at = { ...recorder(), runInput: async () => {}, script: SCRIPT, homeDir: '/' }
    const chosen = firstAvailable([systemdScheduler(systemd), atScheduler(at)])
    expect(await chosen.available()).toBe(true)
    expect(chosen.kind).toBe('at')
    const none = firstAvailable([systemdScheduler(systemd)])
    expect(await none.available()).toBe(false)
    expect(none.kind).toBe('none')
  })
})

describe('the job file the script sources', () => {
  it('single-quotes every value, so a message cannot run as shell', () => {
    const vars = jobVars({
      sessionId: 'abc', cwd: "/work/it's here", text: "continue'; touch pwned #\n$(whoami)", at: AT, claudeBin: 'claude',
      shell: '/bin/zsh', env: { CLAUDE_CONFIG_DIR: '/acc/work', 'BAD KEY': 'x' }, jobKind: 'launchd',
    })
    expect(vars).toContain(`TEXT='continue'\\''; touch pwned #\n$(whoami)'`)
    expect(vars).toContain(`CWD='/work/it'\\''s here'`)
    expect(vars).toContain(`AT=${String(Math.ceil(AT / 1000))}`)
    expect(vars).toContain("CLAUDE_CONFIG_DIR='/acc/work'\nexport CLAUDE_CONFIG_DIR")
    expect(vars).not.toContain('BAD KEY')
    expect(vars).toContain('JOB_KIND=launchd')
  })
})
