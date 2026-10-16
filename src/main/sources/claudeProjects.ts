import { join } from 'node:path'
import type { SessionMeta } from '@shared/types'
import { scanProjects, type ScanOptions } from '../scanner/sessionScanner'
import { encodeProjectDirName } from '../scanner/projectDirName'

/** `<config root>/projects`, where Claude Code keeps one folder per project. */
export function projectsDir(configRoot: string): string {
  return join(configRoot, 'projects')
}

/**
 * What the session services and the watcher need from a place sessions live. There is one
 * implementation, `~/.claude/projects`; the interface is the seam where a second source would go.
 */
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
 * The one `SessionSource`: `~/.claude/projects`, the layout Claude Code itself writes.
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
