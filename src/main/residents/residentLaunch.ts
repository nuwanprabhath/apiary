import type { ResidentConfig } from '@shared/domain/residents'
import { CLAUDE_SETTINGS_FILE } from './claudeSettings'
import { cycleMinutesOf } from './cycle'
import type { ResidentKind } from './kinds'
import { RESIDENT_ALLOWED_TOOLS, type ResidentLaunch } from './residentChat'
import type { ResidentPermissions } from './statusText'

/** How a resident's claude is started, and the permissions that start gives it (what `apiary_status` reports). */
export function residentLaunch(kind: ResidentKind, config: ResidentConfig, spaceDir: string, mcpConfig: string, now: Date): { launch: ResidentLaunch; permissions: ResidentPermissions } {
  const disallowedTools = kind.toolPolicy?.disallowedTools ?? []
  return {
    launch: {
      mcpConfig,
      systemPrompt: kind.systemPrompt(config.name, cycleMinutesOf(kind, config) ?? undefined),
      model: config.model, permissionMode: config.permissionMode, disallowedTools,
      ...(kind.pathFirst !== undefined ? { settingsFile: `${spaceDir}/${CLAUDE_SETTINGS_FILE}` } : {}),
    },
    permissions: { mode: config.permissionMode, allowedTools: RESIDENT_ALLOWED_TOOLS, disallowedTools, settingsLoadedAt: now.toISOString() },
  }
}
