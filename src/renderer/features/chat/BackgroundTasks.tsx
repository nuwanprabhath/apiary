import { type JSX, type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'
import type { BackgroundTask } from '@shared/chatTimeline'
import type { SessionId } from '@shared/domain/ids'
import { formatDuration } from '@shared/time'
import { useSecondsClock, useTaskOutput } from '../../state/secondsClock'
import { AgentTaskIcon, ShellTaskIcon } from '../../ui/icons'
import { ChevronIcon } from '../../ui/icons/ChevronIcon'
import { Listbox, optionId, useListboxNav } from '../../ui/Listbox'
import { Popover } from '../../ui/Popover'
import { focusUnlessTyping } from '../../ui/focusUnlessTyping'
import { usePopover } from './usePopover'

const LIST_ID = 'chat-tasks'

/** "1 background task running" / "3 background tasks running". */
function countLabel(n: number): string {
  return n === 1 ? '1 background task running' : `${String(n)} background tasks running`
}

/**
 * The line above the message box while background tasks run — one row that never wraps: how many,
 * the first one's description, and a chevron. It opens a popup listing every task, the way VS Code
 * shows running work as a status entry with a panel behind it.
 */
export function BackgroundTasksLine({ sessionId, tasks }: { sessionId: SessionId; tasks: BackgroundTask[] }): JSX.Element {
  const { open, setOpen, root } = usePopover()
  const first = tasks[0]
  return (
    <div className="chat-tasks" ref={root}>
      <button
        type="button"
        className="btn quiet chat-status-line chat-status-tasks"
        data-testid="chat-status-tasks"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={tasks.map((t) => t.description || t.taskId).join('\n')}
        onClick={() => { setOpen(!open) }}
      >
        <span className="chat-status-glyph" aria-hidden="true"><span className="chat-status-pulse" /></span>
        <span className="chat-status-count">{countLabel(tasks.length)}{' '}</span>
        {first !== undefined && (
          <>
            <span className="chat-status-sep" aria-hidden="true">·{' '}</span>
            <span className="chat-status-detail" title={first.description || first.taskId}>{first.description || first.taskId}</span>
          </>
        )}
        <span className="chat-status-chevron" aria-hidden="true"><ChevronIcon expanded={open} /></span>
      </button>
      {open && <BackgroundTasksPopup sessionId={sessionId} tasks={tasks} />}
    </div>
  )
}

function BackgroundTasksPopup({ sessionId, tasks }: { sessionId: SessionId; tasks: BackgroundTask[] }): JSX.Element {
  const [active, setActive] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const now = useSecondsClock()
  // The list takes the keys once open (the button that opened it had them, so nobody was typing).
  const list = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => { focusUnlessTyping(list.current) }, [])
  const current = Math.min(active, tasks.length - 1)
  const toggle = (taskId: string): void => { setExpanded((e) => (e === taskId ? null : taskId)) }
  const nav = useListboxNav({
    count: tasks.length, active: current, setActive, edges: true,
    onChoose: () => { toggle(tasks[current].taskId) },
  })
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ') { e.preventDefault(); toggle(tasks[current].taskId); return }
    nav.onKeyDown(e)
  }
  return (
    <Popover label="Background tasks" className="chat-menu chat-tasks-popup" testId="chat-tasks-popup">
      <div className="chat-tasks-header">
        <span className="chat-menu-heading">Background tasks</span>
        <span className="chat-tasks-count">{tasks.length}</span>
      </div>
      <Listbox
        as="ul"
        label="Background tasks"
        className="chat-tasks-list"
        activeId={optionId(LIST_ID, current)}
        tabIndex={0}
        ref={list}
        onKeyDown={onKeyDown}
      >
        {tasks.map((t, i) => (
          <TaskRow
            key={t.taskId}
            id={optionId(LIST_ID, i)}
            sessionId={sessionId}
            task={t}
            now={now}
            current={i === current}
            expanded={expanded === t.taskId}
            onToggle={() => { setActive(i); toggle(t.taskId) }}
          />
        ))}
      </Listbox>
    </Popover>
  )
}

interface RowProps {
  id: string
  sessionId: SessionId
  task: BackgroundTask
  now: number
  current: boolean
  expanded: boolean
  onToggle: () => void
}

function TaskRow({ id, sessionId, task, now, current, expanded, onToggle }: RowProps): JSX.Element {
  const Icon = task.kind === 'agent' ? AgentTaskIcon : ShellTaskIcon
  return (
    <li
      id={id}
      role="option"
      aria-selected={current}
      aria-expanded={expanded}
      className="chat-task"
      data-testid="chat-task"
      data-task-id={task.taskId}
    >
      <div className="chat-task-head" onClick={onToggle}>
        <span className="chat-menu-icon" title={task.kind === 'agent' ? 'Agent' : 'Shell'}><Icon /></span>
        <span className="chat-task-text">
          <span className="chat-task-desc" title={task.description}>{task.description || task.taskId}</span>
          {task.command !== null && task.command !== task.description && (
            <span className="chat-task-command" title={task.command}>{task.command}</span>
          )}
        </span>
        <span className="chat-task-meta">
          {task.startedAtMs !== null && <span className="chat-task-elapsed" data-testid="chat-task-elapsed">{formatDuration(now - task.startedAtMs)}</span>}
          <span className="chat-task-id">{task.taskId}</span>
        </span>
      </div>
      {expanded && <TaskOutput sessionId={sessionId} taskId={task.taskId} />}
    </li>
  )
}

/** The last lines of one task's output, bottom-anchored, read again while it is open. */
function TaskOutput({ sessionId, taskId }: { sessionId: SessionId; taskId: string }): JSX.Element {
  const output = useTaskOutput(sessionId, taskId)
  const box = useRef<HTMLPreElement | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [output])
  if (output === null) return <div className="chat-task-output chat-task-output-note" data-testid="chat-task-output">Reading…</div>
  if (!output.available) return <div className="chat-task-output chat-task-output-note" data-testid="chat-task-output">Output isn&apos;t available.</div>
  if (output.lines.length === 0) return <div className="chat-task-output chat-task-output-note" data-testid="chat-task-output">No output yet.</div>
  return <pre className="chat-task-output" data-testid="chat-task-output" ref={box}>{output.lines.join('\n')}</pre>
}
