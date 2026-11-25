import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { errorMessage } from '@shared/errors'
import type { PurgeRequest, PurgeResult } from '@shared/domain/privacy'
import { realPathInside } from '../fs/confine'
import { log } from '../log/logger'

/** One purge item: the files it empties (checked and measured) and how the owning store empties them. */
export interface PurgeTarget {
  paths: string[]
  run: () => Promise<void>
}

export interface PurgeServiceDeps {
  /** The folders Apiary keeps its own data in (userData, and the session database's folder when that
   *  lives elsewhere); every target path must be inside one of them by real path. */
  roots: string[]
  /** null: this item cannot be purged in this build (its store does not exist). */
  targets: Record<keyof PurgeRequest, PurgeTarget | null>
}

/** Bytes under `path`, never following a symlink; 0 for a path that is not there. */
async function bytesOf(path: string): Promise<number> {
  let info
  try { info = await lstat(path) } catch { return 0 }
  if (info.isSymbolicLink()) return 0
  if (!info.isDirectory()) return info.size
  let names: string[]
  try { names = await readdir(path) } catch { return 0 }
  let total = 0
  for (const name of names) total += await bytesOf(join(path, name))
  return total
}

async function isPresent(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch { return false }
}

async function insideAny(roots: string[], path: string): Promise<boolean> {
  for (const root of roots) if (await realPathInside(root, path) !== null) return true
  return false
}

/** The first target path that exists and is not inside any of `roots` by real path, if any. */
async function escapee(roots: string[], paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (await isPresent(path) && !(await insideAny(roots, path))) return path
  }
  return null
}

/**
 * Deletes what the person asked for, item by item. Never anything outside Apiary's own folders, so never
 * the Claude config root (`~/.claude` or `CLAUDE_CONFIG_DIR`) and its transcripts.
 */
export function createPurgeService(deps: PurgeServiceDeps): { purge(req: PurgeRequest): Promise<PurgeResult> } {
  return {
    purge: async (req) => {
      const result: PurgeResult = { removedBytes: 0, failed: [] }
      for (const item of Object.keys(deps.targets) as (keyof PurgeRequest)[]) {
        if (!req[item]) continue
        const target = deps.targets[item]
        if (target === null) { result.failed.push({ item, reason: 'Not available here.' }); continue }
        const outside = await escapee(deps.roots, target.paths)
        if (outside !== null) {
          result.failed.push({ item, reason: "It is outside Apiary's data folder, so it was left alone." })
          continue
        }
        const sizes = async (): Promise<number> => (await Promise.all(target.paths.map(bytesOf))).reduce((a, b) => a + b, 0)
        const before = await sizes()
        try {
          await target.run()
        } catch (e) {
          result.failed.push({ item, reason: errorMessage(e) })
        }
        result.removedBytes += Math.max(0, before - await sizes())
      }
      log.info('privacy', 'purge', { items: Object.keys(req).filter((k) => req[k as keyof PurgeRequest]).length, failed: result.failed.length, removedBytes: result.removedBytes })
      return result
    },
  }
}
