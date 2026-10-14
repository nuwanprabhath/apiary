import { useEffect, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { BackgroundTaskOutput } from '@shared/chatTimeline'
import { createLocalStore } from './createLocalStore'
import { loadTaskOutput } from './transcript'

/** The time, to the second, for every elapsed counter on screen. */
const clock = createLocalStore(Date.now())
let readers = 0
let timer: ReturnType<typeof setInterval> | null = null

/**
 * The current time, advancing once a second while anything reads it: one timer for the whole window,
 * however many counters are on screen, stopped when the last one goes (`no-polling-in-features`).
 */
export function useSecondsClock(): number {
  useEffect(() => {
    readers += 1
    clock.set(Date.now())
    timer ??= setInterval(() => { clock.set(Date.now()) }, 1000)
    return () => {
      readers -= 1
      if (readers === 0 && timer !== null) { clearInterval(timer); timer = null }
    }
  }, [])
  return clock.useStore()
}

/** How often an open task's output is read again. */
const TASK_OUTPUT_REFRESH_MS = 1500

/**
 * The end of one background task's output while it is shown, read again every 1.5 s; null until the
 * first read answers, or when no task is given.
 */
export function useTaskOutput(sessionId: SessionId, taskId: string | null): BackgroundTaskOutput | null {
  const [output, setOutput] = useState<{ taskId: string; value: BackgroundTaskOutput } | null>(null)
  useEffect(() => {
    if (taskId === null) return
    let stopped = false
    let next: ReturnType<typeof setTimeout> | null = null
    const read = async (): Promise<void> => {
      const value = await loadTaskOutput(sessionId, taskId)
      if (stopped) return
      setOutput({ taskId, value })
      next = setTimeout(() => { void read() }, TASK_OUTPUT_REFRESH_MS)
    }
    void read()
    return () => {
      stopped = true
      if (next !== null) clearTimeout(next)
    }
  }, [sessionId, taskId])
  return output !== null && output.taskId === taskId ? output.value : null
}
