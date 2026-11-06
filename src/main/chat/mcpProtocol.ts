import { isOneOf, isRecord } from '@shared/guards'
import { isWebUrl, MCP_SERVER_STATUSES, type McpRequest, type McpServer, type McpSignIn } from '@shared/domain/mcp'

/**
 * The control requests behind the MCP card, pure. Shapes measured on claude 2.1.316: `mcp_status`
 * answers `{ mcpServers: [{ name, status, scope, transport, error?, serverInfo?, tools: [{ name }] }] }`;
 * `mcp_authenticate` answers `{ authUrl, requiresUserAction, callbackExpected }`; the others answer
 * nothing, or an error such as "MCP server x is disabled — enable it (mcp_toggle) before reconnecting".
 */
export function mcpControl(request: McpRequest): Record<string, unknown> {
  switch (request.kind) {
    case 'status': return { subtype: 'mcp_status' }
    case 'toggle': return { subtype: 'mcp_toggle', serverName: request.server, enabled: request.enabled }
    case 'reconnect': return { subtype: 'mcp_reconnect', serverName: request.server }
    case 'authenticate': return { subtype: 'mcp_authenticate', serverName: request.server }
    case 'callback': return { subtype: 'mcp_oauth_callback_url', serverName: request.server, callbackUrl: request.url }
    case 'clear-auth': return { subtype: 'mcp_clear_auth', serverName: request.server }
  }
}

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** The servers of an `mcp_status` answer; null when it is not one. A status claude adds later reads as pending. */
export function mcpServersOf(response: unknown): McpServer[] | null {
  const servers = isRecord(response) ? response.mcpServers : undefined
  if (!Array.isArray(servers)) return null
  return servers.flatMap((s: unknown): McpServer[] => {
    if (!isRecord(s)) return []
    const name = nonEmpty(s.name)
    if (name === null) return []
    const tools = Array.isArray(s.tools) ? s.tools.flatMap((t: unknown) => (isRecord(t) && nonEmpty(t.name) !== null ? [String(t.name)] : [])) : []
    return [{
      name,
      status: isOneOf(MCP_SERVER_STATUSES, s.status) ? s.status : 'pending',
      scope: nonEmpty(s.scope) ?? 'other',
      transport: nonEmpty(s.transport) ?? (isRecord(s.config) ? nonEmpty(s.config.type) : null) ?? '',
      error: nonEmpty(s.error),
      tools,
      version: isRecord(s.serverInfo) ? nonEmpty(s.serverInfo.version) : null,
    }]
  })
}

/** The page an `mcp_authenticate` answer asks to open; null when there is nothing to open (already signed in). */
export function mcpSignInOf(server: string, response: unknown): McpSignIn | null {
  if (!isRecord(response)) return null
  const url = nonEmpty(response.authUrl)
  if (url === null || !isWebUrl(url)) return null
  return { server, url, callbackExpected: response.callbackExpected === true }
}
