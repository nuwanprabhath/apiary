import { errorMessage } from '@shared/errors'
import { isFiniteNumber, isRecord } from '@shared/guards'
import { JsonStore } from '../fs/jsonStore'
import { log } from '../log/logger'
import type { WindowBounds } from './windowBounds'
import type { WindowLayoutReport } from '@shared/types'

export interface WindowLayoutRecord extends WindowLayoutReport {
  bounds: WindowBounds
  /**
   * False for a record whose bounds arrived before its first real `reportLayout` call — e.g. a
   * window opened and moved, then the app quit inside the renderer's 500ms debounce. Without this,
   * that record is a `{ preset: 'single', panes: [] }` placeholder indistinguishable from a window
   * the user had genuinely emptied out, and the restore task would recreate it empty, discarding
   * whatever was actually open. Only `reportLayout` ever sets this true; `reportBounds` never does.
   */
  hasLayout: boolean
}

interface SessionLayoutFile { windows: WindowLayoutRecord[] }

function isWindowBounds(v: unknown): v is WindowBounds {
  return isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y)
    && isFiniteNumber(v.width) && isFiniteNumber(v.height)
}

function isWindowRecord(v: unknown): v is WindowLayoutRecord {
  return isRecord(v) && isFiniteNumber(v.number) && isWindowBounds(v.bounds)
    && isRecord(v.layout)
    && Array.isArray(v.live) && v.live.every((s) => typeof s === 'string')
    && typeof v.hasLayout === 'boolean'
}

/**
 * The on-disk record as a `JsonStore`: an empty file on anything unreadable or malformed. The
 * caller (main/index.ts) treats an empty file exactly like "no record for this window" and opens a
 * single default window — restore must never fail the whole launch over one bad record. Files
 * written before it carried a `version` read as `undefined`, which is fine: there is one shape.
 */
function createLayoutFileStore(file: string): JsonStore<SessionLayoutFile> {
  return new JsonStore<SessionLayoutFile>({
    file,
    version: 1,
    parse: (raw) => (isRecord(raw) && Array.isArray(raw.windows) ? { windows: raw.windows.filter(isWindowRecord) } : { windows: [] }),
    fallback: () => ({ windows: [] }),
  })
}

export interface SessionLayoutStore {
  reportLayout(report: WindowLayoutReport): void
  reportBounds(windowNumber: number, bounds: WindowBounds): void
  removeWindow(windowNumber: number): void
  flush(): void
  snapshot(): SessionLayoutFile
}

const EMPTY_BOUNDS: WindowBounds = { x: 0, y: 0, width: 1400, height: 900 }

/**
 * In-memory record of every open window, written to disk debounced. Two independent debounces are
 * deliberately one: the renderer already waits ~500ms after its own last change before calling
 * `reportLayout`, so a further main-side delay only needs to coalesce a burst of *different*
 * windows reporting close together (e.g. all four resizing at relaunch) into one disk write.
 */
export function createSessionLayoutStore(file: string, writeDelayMs = 500): SessionLayoutStore {
  const fileStore = createLayoutFileStore(file)
  const windows = new Map<number, WindowLayoutRecord>(
    fileStore.load().windows.map((w) => [w.number, w]),
  )
  /** A read-only home directory should not crash the app — same bargain as settings.ts. */
  const write = (): void => {
    try {
      fileStore.save({ windows: [...windows.values()] })
    } catch (e) {
      log.warn('layout', 'could not write the window layout', { error: errorMessage(e) })
    }
  }
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleWrite = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      write()
    }, writeDelayMs)
  }

  return {
    reportLayout(report) {
      const existing = windows.get(report.number)
      windows.set(report.number, { ...report, bounds: existing?.bounds ?? EMPTY_BOUNDS, hasLayout: true })
      scheduleWrite()
    },
    reportBounds(windowNumber, bounds) {
      // A bounds report can arrive before the window's first layout report (e.g. right after
      // open, before the renderer's own 500ms debounce fires) — start a record rather than
      // dropping it, so the bounds are not lost once the layout report does land. Marked
      // `hasLayout: false` so a restore reading this before the real layout ever arrives (quit
      // landing inside that debounce) can tell it apart from a window genuinely closed empty.
      const existing = windows.get(windowNumber)
      windows.set(windowNumber, existing === undefined
        ? { number: windowNumber, bounds, layout: { preset: 'single', panes: [] }, live: [], hasLayout: false }
        : { ...existing, bounds })
      scheduleWrite()
    },
    removeWindow(windowNumber) {
      windows.delete(windowNumber)
      scheduleWrite()
    },
    flush() {
      if (timer !== null) { clearTimeout(timer); timer = null }
      write()
    },
    snapshot() {
      return { windows: [...windows.values()] }
    },
  }
}
