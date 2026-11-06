import { describe, it, expect } from 'vitest'
import { mcpControl, mcpServersOf, mcpSignInOf } from '../../src/main/chat/mcpProtocol'
import { isMcpRequest } from '@shared/domain/mcp'

/** Trimmed from a real `mcp_status` answer (claude 2.1.316). */
const STATUS = {
  mcpServers: [
    {
      name: 'cypress-inspect', status: 'connected', serverInfo: { name: 'cypress-inspect', version: '0.21.0' },
      config: { type: 'stdio', command: 'node', args: ['bin/cypress-inspect.js', 'mcp'] }, transport: 'stdio', scope: 'user', source: 'user',
      tools: [{ name: 'status', annotations: { readOnly: true } }, { name: 'rerun_spec', annotations: { destructive: true } }],
    },
    { name: 'claude.ai Gmail', status: 'needs-auth', transport: 'claudeai-proxy', scope: 'claudeai', source: 'claudeai' },
    { name: 'broken', status: 'failed', error: 'spawn uvx ENOENT', config: { type: 'stdio' }, scope: 'local', tools: [] },
    { name: 'later', status: 'reconnecting-soon', scope: 'project' },
    { status: 'connected' },
  ],
}

describe('the MCP control requests', () => {
  it('reads every server of an mcp_status answer: status, scope, transport, tools, version and error', () => {
    expect(mcpServersOf(STATUS)).toEqual([
      { name: 'cypress-inspect', status: 'connected', scope: 'user', transport: 'stdio', error: null, tools: ['status', 'rerun_spec'], version: '0.21.0' },
      { name: 'claude.ai Gmail', status: 'needs-auth', scope: 'claudeai', transport: 'claudeai-proxy', error: null, tools: [], version: null },
      // No transport field: the config's type says it.
      { name: 'broken', status: 'failed', scope: 'local', transport: 'stdio', error: 'spawn uvx ENOENT', tools: [], version: null },
      // A status claude adds later is not dropped; a server with no name is.
      { name: 'later', status: 'pending', scope: 'project', transport: '', error: null, tools: [], version: null },
    ])
    expect(mcpServersOf({ commands: [] })).toBeNull()
  })

  it('names the server in each request as claude reads it', () => {
    expect(mcpControl({ kind: 'status' })).toEqual({ subtype: 'mcp_status' })
    expect(mcpControl({ kind: 'toggle', server: 'x', enabled: false })).toEqual({ subtype: 'mcp_toggle', serverName: 'x', enabled: false })
    expect(mcpControl({ kind: 'callback', server: 'x', url: 'http://localhost:1/cb?code=1' }))
      .toEqual({ subtype: 'mcp_oauth_callback_url', serverName: 'x', callbackUrl: 'http://localhost:1/cb?code=1' })
  })

  it('takes the sign-in page from an mcp_authenticate answer, and none that is not a web page', () => {
    expect(mcpSignInOf('g', { authUrl: 'https://claude.ai/settings/connectors?x=1', requiresUserAction: true, callbackExpected: false }))
      .toEqual({ server: 'g', url: 'https://claude.ai/settings/connectors?x=1', callbackExpected: false })
    expect(mcpSignInOf('g', { requiresUserAction: false, callbackExpected: false })).toBeNull()
    expect(mcpSignInOf('g', { authUrl: 'file:///etc/passwd' })).toBeNull()
  })

  it('accepts only requests it can carry out', () => {
    expect(isMcpRequest({ kind: 'reconnect', server: 'x' })).toBe(true)
    expect(isMcpRequest({ kind: 'reconnect', server: '' })).toBe(false)
    expect(isMcpRequest({ kind: 'toggle', server: 'x' })).toBe(false)
    expect(isMcpRequest({ kind: 'callback', server: 'x', url: 'javascript:1' })).toBe(false)
    expect(isMcpRequest({ kind: 'delete', server: 'x' })).toBe(false)
  })
})
