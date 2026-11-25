import type { ResidentConfig, ResidentMessage, ResidentTurnOrigin } from '@shared/domain/residents'
import type { LoginShellSpawn } from '../exec/spawnLoginShell'
import type { ResidentKind } from './kinds'
import type { McpServer } from './mcp/server'
import { ResidentChat } from './residentChat'
import { residentLaunch } from './residentLaunch'
import { ResidentSpace } from './residentSpace'
import type { Resident } from './residentStatus'

/** What a running claude was started with: a change to any of it restarts the claude once idle. */
export const launchKey = (c: ResidentConfig): string =>
  `${c.model}\n${c.name}\n${c.permissionMode}\n${String(c.cycleEveryMinutes)}\n${JSON.stringify(c.options)}`

/** What a new resident and its chat reach of the service. */
export interface ResidentHost {
  root: string
  kind: ResidentKind
  server: McpServer
  claudeBin: () => string | undefined
  launchEnv: () => Record<string, string>
  titleOf: (sessionId: string) => string | null
  now: () => Date
  spawn?: LoginShellSpawn
  onMessage: (r: Resident, message: ResidentMessage) => void
  onActivity: (r: Resident) => void
  onTurnEnded: (r: Resident, origin: ResidentTurnOrigin, text: string) => void
}

/** A resident record for `config`, with its space and its chat (not started). */
export function createResident(config: ResidentConfig, host: ResidentHost): Resident {
  const { kind, server } = host
  const space = new ResidentSpace(host.root, config.id)
  // The chat's callbacks read the live config through this object, which becomes the resident.
  const resident: Omit<Resident, 'chat'> = {
    config, kind, space, launchedAs: null, permissions: null, nextCycleAt: null, cycleEvery: null, ready: Promise.resolve(),
    preparedFor: null, preparing: false, actions: [], turnSeq: 0, holds: [], permissionsKey: '', cycleSkipLogged: null,
  }
  const chat = new ResidentChat({
    space,
    name: () => resident.config.name,
    claudeBin: host.claudeBin,
    env: () => ({ ...host.launchEnv(), ...(kind.env?.(resident.config, space.dir) ?? {}) }),
    titleOf: host.titleOf,
    launch: async () => {
      await resident.ready
      const url = await server.start()
      resident.launchedAs = launchKey(resident.config)
      const mcpConfig = space.writeMcpConfig(url, server.issueToken(config.id))
      const started = residentLaunch(kind, resident.config, space.dir, mcpConfig, host.now())
      resident.permissions = started.permissions
      return started.launch
    },
    onMessage: (message) => { host.onMessage(created, message) },
    onActivity: () => { host.onActivity(created) },
    onTurnEnded: (origin, text) => { host.onTurnEnded(created, origin, text) },
    ...(host.spawn !== undefined ? { spawn: host.spawn } : {}),
  })
  const created: Resident = Object.assign(resident, { chat })
  return created
}
