import { openInVsCode as spawnVsCode } from './detectVsCode'
import type { SessionResolver } from '../sessions/sessionResolver'

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

  /** Opens the session's folder in VS Code. Rejects if VS Code was not found or the folder is gone. */
  async open(key: string, isPtyId: boolean): Promise<void> {
    if (this.vsCodePath === null) throw new Error('VS Code was not found on this machine')
    const cwd = this.resolver.resolveShellCwd(key, isPtyId)
    spawnVsCode(this.vsCodePath, cwd)
  }
}
