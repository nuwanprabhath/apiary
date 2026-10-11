import { openFileInVsCode, openInVsCode as spawnVsCode } from './detectVsCode'
import { resolveMentionedFile, type MentionedFile } from './mentionedFile'
import type { SessionResolver } from '../sessions/sessionResolver'
import type { TerminalRef } from '@shared/domain/ids'

export interface VsCodeServiceDeps {
  resolver: SessionResolver
  /** Resolved once at startup by `detectVsCode`; null when none was found. */
  vsCodePath: string | null
}

/**
 * Whether VS Code is available, and opening a session's folder in it (MAIN-14 step 4) — pure move
 * out of `AppService`. `vsCodePath` is checked once at launch and never re-probed per hover; see
 * `tests/unit/vscodeService.test.ts`.
 */
export class VsCodeService {
  private readonly resolver: SessionResolver
  private readonly vsCodePath: string | null

  constructor(deps: VsCodeServiceDeps) {
    this.resolver = deps.resolver
    this.vsCodePath = deps.vsCodePath
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
   * against the session's own folder and refused unless it is a file inside it (`resolveMentionedFile`).
   * Launches nothing.
   */
  async resolveMentionedFile(terminal: TerminalRef, mention: string): Promise<MentionedFile> {
    const found = await resolveMentionedFile(this.resolveFolder(terminal), mention)
    if (found === null) throw new Error('That is not a file in this session\'s folder')
    return found
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
