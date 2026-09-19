import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { WindowBounds } from './settings'
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

export interface SessionLayoutFile { windows: WindowLayoutRecord[] }

function isWindowBounds(v: unknown): v is WindowBounds {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Record<string, unknown>
  return typeof b.x === 'number' && typeof b.y === 'number'
    && typeof b.width === 'number' && typeof b.height === 'number'
}

function isRecord(v: unknown): v is WindowLayoutRecord {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return typeof r.number === 'number' && isWindowBounds(r.bounds)
    && typeof r.layout === 'object' && r.layout !== null
    && Array.isArray(r.live) && r.live.every((s) => typeof s === 'string')
    && typeof r.hasLayout === 'boolean'
}

/**
 * Reads the on-disk record, falling back to an empty file on anything unreadable or malformed.
 * The caller (main/index.ts) treats an empty file exactly like "no record for this window" and
 * opens a single default window — restore must never fail the whole launch over one bad record.
 */
export function loadSessionLayout(file: string): SessionLayoutFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { windows?: unknown }).windows)) {
      return { windows: [] }
    }
    const windows = (raw as { windows: unknown[] }).windows.filter(isRecord)
    return { windows }
  } catch {
    return { windows: [] }
  }
}

export function saveSessionLayoutNow(file: string, data: SessionLayoutFile): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2))
  } catch {
    // A read-only home directory should not crash the app — same bargain as settings.ts.
  }
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
  const windows = new Map<number, WindowLayoutRecord>(
    loadSessionLayout(file).windows.map((w) => [w.number, w]),
  )
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleWrite = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      saveSessionLayoutNow(file, { windows: [...windows.values()] })
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
      saveSessionLayoutNow(file, { windows: [...windows.values()] })
    },
    snapshot() {
      return { windows: [...windows.values()] }
    },
  }
}
