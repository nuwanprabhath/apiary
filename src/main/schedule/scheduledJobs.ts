import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import { ignoreErrors } from '@shared/ignoreErrors'
import { shellQuote } from '../exec/shellQuote'
import { ensurePrivateDir, writeExecutableText, writePrivateText } from '../fs/atomicWrite'
import { removeFileForProgram, writeFileForProgram } from '../fs/textFile'

/** What the OS job needs to send without Apiary: written beside the record when it is saved. */
export interface JobLaunch {
  sessionId: string
  cwd: string
  text: string
  /** Epoch ms; the script waits for it when the OS woke it early (launchd has minute steps). */
  at: number
  /** `claude`, or the path the settings name; resolved by the login shell like a terminal's. */
  claudeBin: string
  /** The login shell the script runs `claude` through, as Apiary's terminals do. */
  shell: string
  /** The account's environment (`AccountService.launchEnv`): `CLAUDE_CONFIG_DIR` for an added one. */
  env: Record<string, string>
  /** Test-only (`APIARY_SCHEDULE_MODEL`): the model the resumed run uses. */
  model?: string
  /** Which OS job runs it, so the script can remove that job when it is done. */
  jobKind: OsJobKind
}

export type OsJobKind = 'launchd' | 'systemd' | 'at' | 'none'

/** What the script recorded when it ran: its `claude` exit code, when, and the end of its output. */
export interface JobResult { code: number; at: number; logTail: string }

/** A `.running` marker older than this is a script that died before writing `.done`. */
export const STALE_RUNNING_MS = 30 * 60_000
const LOG_TAIL_CHARS = 600
const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/

/** The launchd label and systemd unit stem of a schedule's OS job. */
export const jobName = (id: string): string => `apiary-scheduled-${id}`
export const launchdLabel = (id: string): string => `com.apiary.scheduled.${id}`

/**
 * The POSIX sh script every OS job runs with the schedule id. It sends nothing while Apiary is
 * running (Apiary's own timer sends then), waits out an early wake, marks itself running so a
 * starting Apiary does not send twice, runs `claude --resume <id> -p -- <text>` in the session's
 * folder through the login shell, records the result as `<id>.done`, and removes its OS job last
 * (removing a launchd job ends the process that asks).
 */
function scheduledScript(userData: string): string {
  const dir = shellQuote(join(userData, 'scheduled'))
  const pidFile = shellQuote(join(userData, 'apiary.pid'))
  return `#!/bin/sh
# Apiary: sends a scheduled message while Apiary is closed. Written by Apiary on every launch.
id="$1"
case "$id" in ''|*[!0-9A-Fa-f-]*) exit 2 ;; esac
dir=${dir}
vars="$dir/$id.vars"
remove_job() {
  case "$JOB_KIND" in
    launchd)
      plist="$HOME/Library/LaunchAgents/com.apiary.scheduled.$id.plist"
      rm -f "$plist"
      launchctl bootout "gui/$(id -u)/com.apiary.scheduled.$id" >/dev/null 2>&1 ;;
    systemd) systemctl --user stop "apiary-scheduled-$id.timer" >/dev/null 2>&1 ;;
  esac
}
[ -f "$vars" ] || exit 0
. "$vars"
now=$(date +%s)
[ "$now" -lt "$AT" ] && sleep $((AT - now))
pidfile=${pidFile}
if [ -f "$pidfile" ]; then
  pid=$(cat "$pidfile")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -qi -e electron -e apiary; then
    exit 0
  fi
fi
: > "$dir/$id.running"
if [ -n "$MODEL" ]; then
  set -- --resume "$SID" --model "$MODEL" -p -- "$TEXT"
else
  set -- --resume "$SID" -p -- "$TEXT"
fi
if cd "$CWD" 2>/dev/null; then
  "$SHELL_BIN" -l -c 'exec "$0" "$@"' "$CLAUDE_BIN" "$@" > "$dir/$id.log" 2>&1 < /dev/null
  code=$?
else
  echo "The session's folder is gone: $CWD" > "$dir/$id.log"
  code=1
fi
printf '{"code":%d,"at":%s}\\n' "$code" "$(date +%s)" > "$dir/$id.done.tmp" && mv "$dir/$id.done.tmp" "$dir/$id.done"
rm -f "$dir/$id.running" "$vars"
remove_job
`
}

/** The vars file the script sources: every value single-quoted, so no text can run as shell. */
export function jobVars(launch: JobLaunch): string {
  const lines = [
    `SID=${shellQuote(launch.sessionId)}`,
    `CWD=${shellQuote(launch.cwd)}`,
    `TEXT=${shellQuote(launch.text)}`,
    `AT=${String(Math.ceil(launch.at / 1000))}`,
    `CLAUDE_BIN=${shellQuote(launch.claudeBin)}`,
    `SHELL_BIN=${shellQuote(launch.shell)}`,
    `MODEL=${shellQuote(launch.model ?? '')}`,
    `JOB_KIND=${launch.jobKind}`,
  ]
  for (const [key, value] of Object.entries(launch.env)) {
    if (ENV_KEY.test(key)) lines.push(`${key}=${shellQuote(value)}`, `export ${key}`)
  }
  return `${lines.join('\n')}\n`
}

function parseDone(text: string): { code: number; at: number } | null {
  const raw = ignoreErrors(() => JSON.parse(text) as unknown, 'a .done the script is still writing')
  if (!isRecord(raw) || typeof raw.code !== 'number' || typeof raw.at !== 'number') return null
  return { code: raw.code, at: raw.at * 1000 }
}

/**
 * The files Apiary and the script share under userData: `bin/apiary-scheduled`, `apiary.pid`, and
 * per schedule `scheduled/<id>.vars` (written by Apiary), `.running`, `.log` and `.done` (written
 * by the script).
 */
export class ScheduledJobs {
  readonly script: string
  private readonly dir: string
  private readonly pidFile: string

  constructor(private readonly userData: string) {
    this.script = join(userData, 'bin', 'apiary-scheduled')
    this.dir = join(userData, 'scheduled')
    this.pidFile = join(userData, 'apiary.pid')
  }

  /** Rewritten every launch, so a new Apiary's script replaces an old one's; and this run's pid, which tells the script Apiary is open. */
  install(pid: number): void {
    mkdirSync(join(this.userData, 'bin'), { recursive: true })
    writeExecutableText(this.script, scheduledScript(this.userData))
    writeFileForProgram(this.pidFile, `${String(pid)}\n`)
  }

  uninstall(): void { removeFileForProgram(this.pidFile) }

  write(id: string, launch: JobLaunch): void {
    ensurePrivateDir(this.dir)
    writePrivateText(join(this.dir, `${id}.vars`), jobVars(launch))
  }

  remove(id: string): void {
    for (const ext of ['vars', 'running', 'log', 'done', 'done.tmp']) removeFileForProgram(join(this.dir, `${id}.${ext}`))
  }

  /** What the script recorded, once it has finished. */
  result(id: string): JobResult | null {
    const done = ignoreErrors(() => readFileSync(join(this.dir, `${id}.done`), 'utf8'), 'no .done: the script has not run')
    const parsed = done === undefined ? null : parseDone(done)
    if (parsed === null) return null
    return { ...parsed, logTail: this.logTail(id) }
  }

  /** When the script started sending, while it is sending; null when it is not. */
  runningSince(id: string): number | null {
    const file = join(this.dir, `${id}.running`)
    if (!existsSync(file)) return null
    return ignoreErrors(() => statSync(file).mtimeMs, 'the script finished between the two calls') ?? null
  }

  /**
   * Removes the `.log` and `.done` of finished schedules last written before `cutoffMs` (epoch);
   * returns how many files went. A schedule whose `.vars` is still there is pending and kept whole.
   */
  pruneFinished(cutoffMs: number): number {
    return this.removeFinished((file) => (ignoreErrors(() => statSync(file).mtimeMs, 'gone already') ?? Infinity) < cutoffMs)
  }

  /** Every finished schedule's `.log` and `.done`; a pending schedule's files are kept. Returns how many went. */
  clearLogs(): number {
    return this.removeFinished(() => true)
  }

  private removeFinished(doomed: (file: string) => boolean): number {
    const names = ignoreErrors(() => readdirSync(this.dir), 'no folder: nothing was ever scheduled') ?? []
    const pending = new Set(names.filter((n) => n.endsWith('.vars')).map((n) => n.slice(0, -'.vars'.length)))
    let removed = 0
    for (const name of names) {
      const match = /^(.+)\.(log|done)$/.exec(name)
      if (match === null || pending.has(match[1] ?? '')) continue
      const file = join(this.dir, name)
      if (!doomed(file)) continue
      removeFileForProgram(file)
      removed += 1
    }
    return removed
  }

  logTail(id: string): string {
    const text = ignoreErrors(() => readFileSync(join(this.dir, `${id}.log`), 'utf8'), 'no log: the script wrote nothing') ?? ''
    return text.trim().slice(-LOG_TAIL_CHARS)
  }
}
