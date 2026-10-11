import type { TerminalRef } from '@shared/domain/ids'
import { launchDetached, type LaunchSpawn } from '../exec/launchDetached'
import type { Resolved, ResolveRequest } from './protocol'

/** What the router hands a bridged call: the call, the window's connection and the host it was made with. */
interface BridgedCall {
  key: 'openInVsCode' | 'openMentionedFile'
  args: unknown[]
  /** The ssh alias the user connected with, so VS Code reads the same `~/.ssh/config` entry. */
  sshHost: string
  w: number
  connection: { resolve(w: number, request: ResolveRequest): Promise<Resolved> }
}

export type BridgeHandler = (call: BridgedCall) => Promise<void>

export interface VsCodeBridgeDeps {
  /** This machine's `code`, found at launch; null when there is none. */
  vsCodePath: () => string | null
  spawn?: LaunchSpawn
}

/**
 * Opens VS Code on a work machine's path (`bridged` scope, `scopes.ts`): the work machine says
 * where the folder or file is, this machine launches its own VS Code over Remote-SSH on it. The
 * host and the path are separate arguments and never reach a shell.
 */
export function createVsCodeBridge(deps: VsCodeBridgeDeps): BridgeHandler {
  return async ({ key, args, sshHost, w, connection }) => {
    const codePath = deps.vsCodePath()
    if (codePath === null) throw new Error('VS Code was not found on this machine')
    const terminal = args[0] as TerminalRef
    const remote = ['--remote', `ssh-remote+${sshHost}`]
    if (key === 'openInVsCode') {
      const { path } = await connection.resolve(w, { what: 'session-folder', terminal })
      launchDetached(codePath, [...remote, path], 'vscode', deps.spawn)
      return
    }
    const { path, line } = await connection.resolve(w, { what: 'mentioned-file', terminal, mention: args[1] as string })
    launchDetached(codePath, [...remote, '--goto', line === undefined ? path : `${path}:${String(line)}`], 'vscode', deps.spawn)
  }
}
