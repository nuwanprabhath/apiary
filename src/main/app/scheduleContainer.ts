import { asAccountId, type SessionId } from '@shared/domain/ids'
import { IPC } from '@shared/api'
import type { AccountService } from '../accounts/accountService'
import type { ChatService } from '../chat/chatService'
import { ptysOnSession } from '../claude/trackerAccounts'
import { createExec } from '../exec/run'
import { runWithInput } from '../exec/runWithInput'
import { loginShell } from '../exec/loginShell'
import type { PtyManager } from '../pty/ptyManager'
import { limitResetInTranscript } from '../schedule/limitReset'
import { NO_OS_SCHEDULER, atScheduler, firstAvailable, launchdScheduler, systemdScheduler, type OsScheduler } from '../schedule/osScheduler'
import { ScheduledJobs } from '../schedule/scheduledJobs'
import { ScheduleService } from '../schedule/scheduleService'
import { createScheduleStore } from '../schedule/scheduleStore'
import type { UsageFeed } from '../statusBar/claudeUsage/usageFeed'
import type { SessionStore } from '../store/sessionStore'
import { broadcast } from '../windows/broadcast'
import type { ContainerPaths } from './containerPaths'
import type { RuntimeEnv } from './env'

/** The machine's one-shot job scheduler: launchd on a Mac, a systemd user timer or `at` on Linux. */
function osSchedulerFor(o: { platform: NodeJS.Platform; script: string; homeDir: string; uid: number }): OsScheduler {
  const exec = createExec({ scope: 'schedule', timeoutMs: 15_000 })
  if (o.platform === 'darwin') return launchdScheduler({ exec, script: o.script, homeDir: o.homeDir, uid: o.uid })
  if (o.platform !== 'linux') return NO_OS_SCHEDULER
  const runInput = async (file: string, args: string[], input: string): Promise<void> => {
    const result = await runWithInput(file, args, { input, timeoutMs: 15_000, scope: 'schedule' })
    if (result.code !== 0) throw new Error(result.stderr.trim() || `${file} exited with ${String(result.code)}`)
  }
  return firstAvailable([
    systemdScheduler({ exec, script: o.script, homeDir: o.homeDir }),
    atScheduler({ exec, runInput, script: o.script, homeDir: o.homeDir }),
  ])
}

/** Whether scheduled messages get OS jobs: `APIARY_OS_SCHEDULER` decides, else on except in a headless (test) run, which must leave nothing on the machine. */
export function osJobsWanted(env: Pick<RuntimeEnv, 'osScheduler' | 'headless'>): boolean {
  return env.osScheduler === undefined ? !env.headless : env.osScheduler === 'on'
}

export interface ScheduleParts {
  service: ScheduleService
  jobs: ScheduledJobs
}

/**
 * Scheduled messages over this machine's sessions: the store, the files the OS job reads, the OS
 * scheduler (`os: false` for a run that must leave no job on the machine) and how a message is
 * delivered while Apiary runs. Built by `createContainer` and the contract loopback alike.
 */
export function createSchedules(o: {
  paths: Pick<ContainerPaths, 'userData' | 'scheduledMessagesFile' | 'configRoot'>
  /** Where the OS job lives (the home folder); null for a run that must leave no job on the machine. */
  os: { homeDir: string } | null
  store: SessionStore
  accounts: AccountService
  chat: ChatService
  service: { pty: PtyManager; claudeBin: string | null; sendPrompt(ptyId: string, text: string): Promise<void>; plugins: { usage: UsageFeed } }
  /** Test-only (`APIARY_SCHEDULE_MODEL`). */
  model: string | undefined
}): ScheduleParts {
  const jobs = new ScheduledJobs(o.paths.userData)
  const configRoot = o.paths.configRoot
  const accountOf = (sessionId: SessionId): string => o.accounts.accountOf(sessionId)
  const service = new ScheduleService({
    store: createScheduleStore(o.paths.scheduledMessagesFile),
    os: o.os === null ? NO_OS_SCHEDULER : osSchedulerFor({ platform: process.platform, script: jobs.script, homeDir: o.os.homeDir, uid: process.getuid?.() ?? 0 }),
    jobs,
    session: (sessionId) => {
      const found = o.store.getSession(sessionId)
      if (found === null || found.cwd === null) throw new Error(`Unknown session: ${sessionId}`)
      return { cwd: found.cwd, account: accountOf(sessionId) }
    },
    launch: (account) => ({
      claudeBin: o.service.claudeBin ?? 'claude',
      shell: loginShell(),
      env: o.accounts.launchEnv(o.accounts.resolve(asAccountId(account))),
      ...(o.model !== undefined ? { model: o.model } : {}),
    }),
    deliver: (sessionId, text) => deliver({ ...o, configRoot }, sessionId, text),
    limitResetsAt: (sessionId) => {
      const usage = o.service.plugins.usage.limitResetsAt(o.accounts.accountOf(sessionId))
      if (usage !== null) return { at: usage, source: 'usage' }
      const file = o.store.getSession(sessionId)?.filePath
      const fromTranscript = file === undefined ? null : limitResetInTranscript(file)
      return fromTranscript === null ? null : { at: fromTranscript, source: 'transcript' }
    },
    onChanged: (state) => { broadcast(IPC.scheduleChanged, state) },
  })
  return { service, jobs }
}

/**
 * Sends a scheduled message the way the person would: into the session's running chat (queued if
 * it is busy, as the composer does), else typed into its terminal's claude, else its chat started
 * headlessly — which takes a terminal's claude over, one process per session — and sent.
 */
async function deliver(
  o: { chat: ChatService; service: { pty: PtyManager; sendPrompt(ptyId: string, text: string): Promise<void> }; configRoot: string; accounts: AccountService; model: string | undefined },
  sessionId: SessionId,
  text: string,
): Promise<void> {
  const chat = o.chat.state(sessionId)
  if (chat !== null && chat.status !== 'exited') { o.chat.send(sessionId, text); return }
  const terminal = ptysOnSession(o.service.pty, o.configRoot, o.accounts, sessionId)[0]
  if (terminal !== undefined) { await o.service.sendPrompt(terminal, text); return }
  await o.chat.start(sessionId, { takeOver: true, ...(o.model !== undefined ? { model: o.model } : {}) })
  o.chat.send(sessionId, text)
}
