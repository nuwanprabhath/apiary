import { join } from 'node:path'
import type { SessionMeta } from '@shared/types'
import { scanProjects, type ScanOptions } from '../scanner/sessionScanner'
import { encodeProjectDirName } from '../scanner/projectDirName'

/**
 * What the session services and the watcher need from a place sessions live (MAIN-18). Today there is
 * exactly one implementation — `~/.claude/projects` — and this interface exists so that stays a
 * fact about the world rather than something baked into `AppService`'s and `registerIpc`'s own
 * code. A second source (a different tool's session directory, say) would add a second
 * implementation of this interface and a `source` column on the session, not a rewrite of either.
 *
 * Deliberately not built out further than this seam: with one source, a registry, a
 * `SessionMeta.source` field and a schema migration would all be speculative (YAGNI for a solo
 * app with one source).
 */
/** `<config root>/projects`, where Claude Code keeps one folder per project. */
export function projectsDir(configRoot: string): string {
  return join(configRoot, 'projects')
}

export interface SessionSource {
  readonly id: 'claude'
  /** Reads every session this source currently knows about. */
  scan(opts?: ScanOptions): Promise<SessionMeta[]>
  /** The directory to watch for new or changed sessions (a `SessionWatcher`, built in the container). */
  readonly watchDir: string
  /** Where this source would keep the transcript for `sessionId` under `cwd`, for callers (a
   *  session move) that need to place a file rather than merely read one. */
  transcriptPathFor(cwd: string, sessionId: string): string
}

/**
 * The one `SessionSource` today: `~/.claude/projects`, the layout Claude Code itself writes.
 * Collects what used to be spread across `appService.ts` (the scan root, and the move target's
 * path), `ipc/index.ts` (the watch root and its depth/ignore rules) and `scanner/projectDirName.ts`
 * (the directory-name encoding) into one place.
 */
export class ClaudeProjectsSource implements SessionSource {
  readonly id = 'claude' as const
  readonly watchDir: string

  constructor(configRoot: string) {
    this.watchDir = projectsDir(configRoot)
  }

  scan(opts?: ScanOptions): Promise<SessionMeta[]> {
    return scanProjects(this.watchDir, opts)
  }

  transcriptPathFor(cwd: string, sessionId: string): string {
    return join(this.watchDir, encodeProjectDirName(cwd), `${sessionId}.jsonl`)
  }
}
