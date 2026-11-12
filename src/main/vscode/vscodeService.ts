import { openFileInVsCode, openInVsCode as spawnVsCode } from './detectVsCode'
import { findMentionedFile, type MentionedFile } from './mentionedFile'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { TerminalRef } from '@shared/domain/ids'

export interface VsCodeServiceDeps {
  resolver: SessionResolver
  /** Resolved once at startup by `detectVsCode`; null when none was found. */
  vsCodePath: string | null
  /** The home folder: a mention written as a full or `~/` path may name a file anywhere in it. */
  homeDir: string
}

const REFUSALS = {
  missing: 'There is no such file (yet): the agent may not have written it when it named it',
  outside: 'Apiary opens only files in this session\'s folder, its repository or your home folder',
  invalid: 'That is not a file name',
} as const

/**
 * Whether VS Code is available, and opening a session's folder in it. `vsCodePath` is checked
 * once at launch and never re-probed per hover.
 */
export class VsCodeService {
  private readonly resolver: SessionResolver
  private readonly vsCodePath: string | null
  private readonly homeDir: string

  constructor(deps: VsCodeServiceDeps) {
    this.resolver = deps.resolver
    this.vsCodePath = deps.vsCodePath
    this.homeDir = deps.homeDir
  }

  /** Whether VS Code was found on this machine at launch. Checked once; does not change at runtime. */
  available(): boolean {
    return this.vsCodePath !== null
  }

  /** The session's folder, resolved the way `open` does, without launching anything. */
  resolveFolder(terminal: TerminalRef): string {
    return this.resolver.resolveShellCwd(terminal)
  }

  /**
   * The file a transcript mention names. `mention` is text as written in a message; it is resolved
   * from the session's own folder (`findMentionedFile`), and a refusal says why. Launches nothing.
   */
  async resolveMentionedFile(terminal: TerminalRef, mention: string): Promise<MentionedFile> {
    const lookup = await findMentionedFile({ folder: this.resolveFolder(terminal), home: this.homeDir }, mention)
    if ('refused' in lookup) throw new Error(REFUSALS[lookup.refused])
    return lookup.found
  }

  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  async open(terminal: TerminalRef): Promise<void> {
    if (this.vsCodePath === null) throw new Error('VS Code was not found on this machine')
    spawnVsCode(this.vsCodePath, this.resolveFolder(terminal))
  }

  /** Opens a file a transcript mentions (see `resolveMentionedFile`). */
  async openMentionedFile(terminal: TerminalRef, mention: string): Promise<void> {
    if (this.vsCodePath === null) throw new Error('VS Code was not found on this machine')
    const found = await this.resolveMentionedFile(terminal, mention)
    openFileInVsCode(this.vsCodePath, found.file, found.line)
  }
}
