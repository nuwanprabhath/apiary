import { isRecord } from '../guards'

/**
 * A chat's MCP servers, as Claude Code's `/mcp` shows them in a terminal. `/mcp` is a terminal
 * dialog that stream-json mode cannot draw, so Apiary reads and drives the servers through claude's
 * control requests (`mcp_status`, `mcp_toggle`, `mcp_reconnect`, `mcp_authenticate`,
 * `mcp_oauth_callback_url`, `mcp_clear_auth`; measured on claude 2.1.316).
 */

export const MCP_SERVER_STATUSES = ['connected', 'pending', 'needs-auth', 'failed', 'disabled'] as const
export type McpServerStatus = (typeof MCP_SERVER_STATUSES)[number]

export interface McpServer {
  name: string
  status: McpServerStatus
  /** Where it is configured: `local`, `project`, `user`, `claudeai`, `dynamic`, `plugin`, … */
  scope: string
  /** `stdio`, `http`, `sse`, `claudeai-proxy`, … */
  transport: string
  /** Why it failed, when claude says. */
  error: string | null
  tools: string[]
  version: string | null
}

/** What the MCP card asks of a chat. Every request is answered with the servers as they are after it. */
export type McpRequest =
  | { kind: 'status' }
  | { kind: 'toggle'; server: string; enabled: boolean }
  | { kind: 'reconnect'; server: string }
  | { kind: 'authenticate'; server: string }
  /** The address the browser ended on after signing in, for a sign-in whose redirect claude could not hear (another computer). */
  | { kind: 'callback'; server: string; url: string }
  | { kind: 'clear-auth'; server: string }

/** A sign-in that `authenticate` started: the page to open, and whether claude waits for its redirect. */
export interface McpSignIn {
  server: string
  url: string
  /** False for a claude.ai connector: it is authorised on claude.ai, then reconnected. */
  callbackExpected: boolean
}

export interface McpAnswer {
  servers: McpServer[]
  signIn: McpSignIn | null
}

/** A web address: what a sign-in page and the redirect pasted back must be. */
export const isWebUrl = (url: string): boolean => /^https?:\/\//.test(url)

const SERVER_KINDS = ['toggle', 'reconnect', 'authenticate', 'callback', 'clear-auth'] as const

export function isMcpRequest(v: unknown): v is McpRequest {
  if (!isRecord(v)) return false
  if (v.kind === 'status') return true
  if (!SERVER_KINDS.some((k) => k === v.kind) || typeof v.server !== 'string' || v.server === '') return false
  if (v.kind === 'toggle') return typeof v.enabled === 'boolean'
  if (v.kind === 'callback') return typeof v.url === 'string' && isWebUrl(v.url)
  return true
}
