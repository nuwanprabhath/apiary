import type { SessionId } from '@shared/domain/ids'
import type { DeskControls } from '../residents/mcp/deskControl'
import type { SessionDriver } from '../driving/sessionDriver'
import type { SlackBridge } from '../slack/slackBridge'

const TASK_TEXT_SHOWN = 80

/** What the adapters tell the desk piece, which owns the listeners. */
export interface DeskControlHooks {
  /** `post` or `finish` wrote to the task's thread. */
  posted(task: string): void
  /** A start for a task began / ended; the new session is on the task when `ended` runs. */
  startBegan(): void
  startEnded(): void
}

/** The tools' view of the session driver and Slack: what `ResidentService.setDesk` is handed. */
export function createDeskControls({ bridge, driver }: { bridge: SlackBridge; driver: SessionDriver }, hooks: DeskControlHooks): DeskControls {
  const tasks = bridge.tasks

  const openTask = (task: string): void => {
    if (tasks.get(task)?.state !== 'open') throw new Error('That Slack task is unknown or already finished.')
  }

  return {
    drive: {
      folders: () => driver.folders(),
      send: async (sessionId, text, task) => {
        if (task !== null) { openTask(task); driver.watch(sessionId); tasks.addSession(task, sessionId) }
        return driver.send(sessionId, text)
      },
      start: async (folderId, text, worktree, task) => {
        if (task !== null) openTask(task)
        if (task !== null) hooks.startBegan()
        try {
          const started = await driver.startSession(folderId, text, worktree ?? undefined)
          if (task !== null) tasks.addSession(task, started.sessionId)
          return { sessionId: started.sessionId, folderName: started.folder.name }
        } finally {
          if (task !== null) hooks.startEnded()
        }
      },
      interrupt: (sessionId) => { driver.interrupt(sessionId) },
      watch: (sessionId, task) => {
        if (task !== null) openTask(task)
        driver.watch(sessionId)
        if (task !== null) tasks.addSession(task, sessionId)
      },
      unwatch: (sessionId) => {
        driver.unwatch(sessionId)
        const task = tasks.taskOfSession(sessionId)
        if (task !== null) tasks.removeSession(task.thread, sessionId)
      },
      watching: () => driver.watched().map((id: SessionId) => {
        const s = driver.stateOf(id)
        const task = tasks.taskOfSession(id)
        return `${s.title} (id: ${id}) · ${s.status}${s.since === null ? '' : ` since ${new Date(s.since).toISOString()}`}${task === null ? '' : ` · task ${task.thread}`}`
      }),
    },
    slack: {
      post: async (task, text) => {
        openTask(task)
        await bridge.post(task, text)
        hooks.posted(task)
      },
      finish: async (task, summary) => {
        const t = tasks.get(task)
        openTask(task)
        await bridge.post(task, summary)
        hooks.posted(task)
        for (const id of t?.sessions ?? []) driver.unwatch(id as SessionId)
        tasks.finish(task)
      },
      openTasks: () => tasks.list().filter((t) => t.state === 'open')
        .map((t) => `${t.thread} · ${t.text.slice(0, TASK_TEXT_SHOWN)} · sessions: ${t.sessions.length === 0 ? 'none' : t.sessions.join(', ')}`),
      addResident: (task, residentId) => { tasks.addResident(task, residentId) },
    },
  }
}
