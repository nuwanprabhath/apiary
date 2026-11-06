import { describe, it, expect, beforeEach, vi } from 'vitest'
import { asSessionId } from '@shared/domain/ids'
import type { McpAnswer, McpRequest, McpServer } from '@shared/domain/mcp'
import { closeMcp, isMcpCommand, openMcp, refreshMcp, runMcp } from '../../src/renderer/state/chatMcp'

// The stores read `window.apiary` to notice a component test's new bridge; give Node one before they load.
const g = vi.hoisted(() => {
  const holder = globalThis as unknown as { window: { apiary: unknown } }
  holder.window = { apiary: {} }
  return holder
})
const S = asSessionId('11111111-1111-4111-8111-111111111111')
const files: McpServer = { name: 'files', status: 'connected', scope: 'user', transport: 'stdio', error: null, tools: [], version: null }
const tracker: McpServer = { name: 'tracker', status: 'needs-auth', scope: 'project', transport: 'http', error: null, tools: [], version: null }
const SIGN_IN = { server: 'tracker', url: 'https://auth.example/tracker', callbackExpected: true }

let answer: (r: McpRequest) => McpAnswer
let chatMcp: ReturnType<typeof vi.fn>
beforeEach(() => {
  answer = () => ({ servers: [files, tracker], signIn: null })
  chatMcp = vi.fn(async (_id: string, r: McpRequest) => answer(r))
  g.window = { apiary: { chatMcp } }
})

describe('the MCP card\'s state', () => {
  it('takes only /mcp alone as the command', () => {
    expect(isMcpCommand(' /mcp ')).toBe(true)
    expect(isMcpCommand('/mcp add x')).toBe(false)
    expect(isMcpCommand('/mcpx')).toBe(false)
  })

  it('opens by preparing the chat and reading the servers; says why when it cannot, and asks nothing', async () => {
    expect(await openMcp(S, async () => null)).toMatchObject({ open: true, reading: false, answer: { servers: [files, tracker] }, error: null })
    chatMcp.mockClear()
    expect(await openMcp(S, async () => 'Claude is working in the terminal')).toMatchObject({ unavailable: 'Claude is working in the terminal', reading: false })
    expect(await openMcp(S, async () => { throw new Error('The folder is gone') })).toMatchObject({ error: 'The folder is gone' })
    expect(chatMcp).not.toHaveBeenCalled()
  })

  it('keeps a sign-in through a refresh and a refusal, and drops it once its server connects', async () => {
    answer = (r) => ({ servers: [files, tracker], signIn: r.kind === 'authenticate' ? SIGN_IN : null })
    expect((await runMcp(S, { kind: 'authenticate', server: 'tracker' })).answer?.signIn).toEqual(SIGN_IN)
    expect((await refreshMcp(S)).answer?.signIn).toEqual(SIGN_IN)
    chatMcp.mockRejectedValueOnce(new Error('Server not found: nope'))
    const refused = await runMcp(S, { kind: 'reconnect', server: 'nope' })
    expect(refused).toMatchObject({ error: 'Server not found: nope', working: null, answer: { signIn: SIGN_IN } })
    answer = () => ({ servers: [files, { ...tracker, status: 'connected' }], signIn: null })
    expect((await runMcp(S, { kind: 'callback', server: 'tracker', url: 'http://localhost:1/cb?code=1' })).answer?.signIn).toBeNull()
  })

  it('closing puts the card away and forgets the error', async () => {
    chatMcp.mockRejectedValueOnce(new Error('claude did not answer'))
    expect((await refreshMcp(S)).error).toBe('claude did not answer')
    closeMcp(S)
    expect((await openMcp(S, async () => 'not now')).error).toBeNull()
  })
})
