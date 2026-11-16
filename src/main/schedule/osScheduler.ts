import { join } from 'node:path'
import { ignoreErrorsAsync } from '@shared/ignoreErrors'
import type { ExecFn } from '../exec/run'
import { shellQuote } from '../exec/shellQuote'
import { twoDigits } from '@shared/domain/schedule'
import { removeFileForProgram, writeFileForProgram } from '../fs/textFile'
import { jobName, launchdLabel, type OsJobKind } from './scheduledJobs'

/**
 * The one-shot OS job that sends a schedule while Apiary is closed: it runs
 * `/bin/sh <script> <id>` at `at`. One module per platform behind this interface, injected into
 * `ScheduleService`, so a unit test uses a fake and checks each one's command lines.
 */
export interface OsScheduler {
  /** Which kind of job it makes; `none` before `available` has decided, or when nothing is there. */
  readonly kind: OsJobKind
  available(): Promise<boolean>
  register(id: string, at: number): Promise<void>
  remove(id: string): Promise<void>
}


/** Nothing can send while Apiary is closed: the UI says "Sends only while Apiary is open". */
export const NO_OS_SCHEDULER: OsScheduler = {
  kind: 'none',
  available: async () => false,
  register: async () => {},
  remove: async () => {},
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * A LaunchAgent whose `StartCalendarInterval` names the minute (local time). Such an interval
 * repeats every year, so the script removes the job once it has run; launchd runs a job missed
 * while the Mac slept when it wakes.
 */
export function launchdPlist(id: string, at: number, script: string): string {
  const d = new Date(at)
  const when = [['Month', d.getMonth() + 1], ['Day', d.getDate()], ['Hour', d.getHours()], ['Minute', d.getMinutes()]] as const
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${launchdLabel(id)}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>${xml(script)}</string><string>${id}</string></array>
  <key>StartCalendarInterval</key>
  <dict>${when.map(([k, v]) => `<key>${k}</key><integer>${String(v)}</integer>`).join('')}</dict>
</dict>
</plist>
`
}

export function launchdScheduler(o: { exec: ExecFn; script: string; homeDir: string; uid: number }): OsScheduler {
  const plistOf = (id: string): string => join(o.homeDir, 'Library', 'LaunchAgents', `${launchdLabel(id)}.plist`)
  const domain = `gui/${String(o.uid)}`
  const remove = async (id: string): Promise<void> => {
    await ignoreErrorsAsync(() => o.exec('launchctl', ['bootout', `${domain}/${launchdLabel(id)}`], o.homeDir), 'a job that is not loaded')
    removeFileForProgram(plistOf(id))
  }
  return {
    kind: 'launchd',
    available: async () => true,
    register: async (id, at) => {
      await remove(id)
      writeFileForProgram(plistOf(id), launchdPlist(id, at, o.script))
      await o.exec('launchctl', ['bootstrap', domain, plistOf(id)], o.homeDir)
    },
    remove,
  }
}

/** `systemd-run`'s calendar form of `at`, in local time (the user manager's zone). */
export function onCalendar(at: number): string {
  const d = new Date(at)
  return `${String(d.getFullYear())}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())} ${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}`
}

/** A transient systemd user timer: it runs once and is unloaded after, so nothing is left to clean. */
export function systemdScheduler(o: { exec: ExecFn; script: string; homeDir: string }): OsScheduler {
  const remove = async (id: string): Promise<void> => {
    await ignoreErrorsAsync(() => o.exec('systemctl', ['--user', 'stop', `${jobName(id)}.timer`], o.homeDir), 'a timer that already ran or never was')
    await ignoreErrorsAsync(() => o.exec('systemctl', ['--user', 'reset-failed', `${jobName(id)}.service`], o.homeDir), 'nothing failed')
  }
  return {
    kind: 'systemd',
    available: async () => (await ignoreErrorsAsync(async () => { await o.exec('systemctl', ['--user', 'show-environment'], o.homeDir); return true }, 'no systemd user manager')) ?? false,
    register: async (id, at) => {
      await remove(id)
      await o.exec('systemd-run', [
        '--user', `--unit=${jobName(id)}`, `--on-calendar=${onCalendar(at)}`,
        '--timer-property=AccuracySec=1s', '--timer-property=Persistent=true',
        '/bin/sh', o.script, id,
      ], o.homeDir)
    },
    remove,
  }
}

/** `at -t`'s time: `[[CC]YY]MMDDhhmm[.SS]`, local. */
export function atTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getFullYear())}${twoDigits(d.getMonth() + 1)}${twoDigits(d.getDate())}${twoDigits(d.getHours())}${twoDigits(d.getMinutes())}.${twoDigits(d.getSeconds())}`
}

/** `at`, where there is no systemd user manager. A job is found again by the id in its command. */
export function atScheduler(o: { exec: ExecFn; runInput: (file: string, args: string[], input: string) => Promise<void>; script: string; homeDir: string }): OsScheduler {
  const remove = async (id: string): Promise<void> => {
    const queue = (await ignoreErrorsAsync(() => o.exec('atq', [], o.homeDir), 'no queue')) ?? ''
    for (const job of queue.split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '').filter((n) => /^\d+$/.test(n))) {
      const body = (await ignoreErrorsAsync(() => o.exec('at', ['-c', job], o.homeDir), 'a job that just ran')) ?? ''
      if (body.includes(`${shellQuote(o.script)} ${id}`)) await ignoreErrorsAsync(() => o.exec('atrm', [job], o.homeDir), 'a job that just ran')
    }
  }
  return {
    kind: 'at',
    available: async () => (await ignoreErrorsAsync(async () => { await o.exec('/bin/sh', ['-c', 'command -v at'], o.homeDir); return true }, 'no at')) ?? false,
    register: async (id, at) => {
      await remove(id)
      await o.runInput('at', ['-t', atTime(at)], `/bin/sh ${shellQuote(o.script)} ${id}\n`)
    },
    remove,
  }
}

/** The first of `candidates` that is available on this machine, decided once; none when none is. */
export function firstAvailable(candidates: readonly OsScheduler[]): OsScheduler {
  let chosen: Promise<OsScheduler> | null = null
  const pick = async (): Promise<OsScheduler> => {
    for (const c of candidates) if (await c.available()) return c
    return NO_OS_SCHEDULER
  }
  const decided = (): Promise<OsScheduler> => (chosen ??= pick())
  const self = {
    kind: 'none' as OsJobKind,
    available: async () => {
      const c = await decided()
      self.kind = c.kind
      return c !== NO_OS_SCHEDULER
    },
    register: async (id: string, at: number) => { await (await decided()).register(id, at) },
    remove: async (id: string) => { await (await decided()).remove(id) },
  }
  return self
}
