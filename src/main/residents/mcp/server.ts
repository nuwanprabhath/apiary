import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { isRecord } from '@shared/guards'
import { errorMessage } from '@shared/errors'
import type { ResidentCapability } from '../kinds'
import type { ResidentSpace } from '../residentSpace'
import { toolsFor, type Tool, type ToolDeps } from './tools'

/** A request body larger than this is refused unread: no tool takes anything near it. */
const MAX_BODY = 1024 * 1024
/** Used when a client names no protocol version; a client that names one gets it echoed. */
const DEFAULT_PROTOCOL = '2025-06-18'

export interface McpServerDeps {
  tools: ToolDeps
  /** The capabilities of the resident's kind, or null for a resident that no longer exists. */
  capabilitiesOf: (residentId: string) => readonly ResidentCapability[] | null
  spaceOf: (residentId: string) => ResidentSpace
  /** Every tool call, before it runs: the resident's activity. */
  onToolCall: (residentId: string, tool: string, args: unknown) => void
  version: string
}

type JsonRpcId = string | number | null
interface RpcError { code: number; message: string }

const digest = (token: string): Buffer => createHash('sha256').update(token).digest()

/**
 * Apiary's tools for its resident agents: MCP over HTTP (JSON-RPC 2.0, JSON responses, no SSE) on
 * 127.0.0.1 and a port the OS picks. Hand-rolled to avoid a dependency (ADR-0021).
 *
 * - Each resident has its own random token; the token decides which tools it sees and may call.
 * - The `Host` header must be the loopback address and port, so a web page that rebinds a DNS
 *   name to 127.0.0.1 cannot reach it.
 * - Started on the first resident's start; never listens when no resident runs.
 */
export class McpServer {
  private server: Server | null = null
  private starting: Promise<string> | null = null
  private port = 0
  /** Resident id → its token's SHA-256, compared in constant time. */
  private readonly tokens = new Map<string, Buffer>()

  constructor(private readonly deps: McpServerDeps) {}

  /** Listens if it does not yet, and resolves with the `/mcp` URL. */
  start(): Promise<string> {
    this.starting ??= new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => { void this.handle(req, res) })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        this.server = server
        this.port = (server.address() as AddressInfo).port
        resolve(this.url())
      })
    })
    return this.starting
  }

  url(): string { return `http://127.0.0.1:${String(this.port)}/mcp` }

  /** A fresh token for the resident, replacing any it had. */
  issueToken(residentId: string): string {
    const token = randomBytes(32).toString('hex')
    this.tokens.set(residentId, digest(token))
    return token
  }

  revokeToken(residentId: string): void { this.tokens.delete(residentId) }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.starting = null
    this.tokens.clear()
    if (server === null) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }

  private residentFor(header: string | undefined): string | null {
    const match = /^Bearer (\S+)$/.exec(header ?? '')
    if (match === null) return null
    const presented = digest(match[1])
    let found: string | null = null
    // Every entry is compared, so the time taken does not say which one matched.
    for (const [id, expected] of this.tokens) if (timingSafeEqual(presented, expected)) found = id
    return found
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? ''
    if (host !== `127.0.0.1:${String(this.port)}` && host !== `localhost:${String(this.port)}`) return plain(res, 403, req)
    if (req.method !== 'POST') return plain(res, 405, req, { Allow: 'POST' })
    if ((req.url ?? '').split('?')[0] !== '/mcp') return plain(res, 404, req)
    const residentId = this.residentFor(req.headers.authorization)
    const capabilities = residentId === null ? null : this.deps.capabilitiesOf(residentId)
    if (residentId === null || capabilities === null) return plain(res, 401, req)
    const body = await readBody(req)
    if (body === null) return plain(res, 413, req)
    let message: unknown
    try {
      message = JSON.parse(body)
    } catch {
      return json(res, rpcError(null, { code: -32700, message: 'Parse error' }))
    }
    if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return json(res, rpcError(null, { code: -32600, message: 'Invalid request' }))
    }
    // A notification (no id) is acknowledged and needs no answer.
    if (!('id' in message)) { res.writeHead(202).end(); return }
    const id = typeof message.id === 'string' || typeof message.id === 'number' ? message.id : null
    const outcome = await this.dispatch(residentId, toolsFor(capabilities), message.method, message.params)
    json(res, 'error' in outcome ? rpcError(id, outcome.error) : { jsonrpc: '2.0', id, result: outcome.result })
  }

  private async dispatch(residentId: string, tools: Tool[], method: string, params: unknown): Promise<{ result: unknown } | { error: RpcError }> {
    const p = isRecord(params) ? params : {}
    switch (method) {
      case 'initialize':
        return {
          result: {
            protocolVersion: typeof p.protocolVersion === 'string' ? p.protocolVersion : DEFAULT_PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: { name: 'apiary', version: this.deps.version },
          },
        }
      case 'ping':
        return { result: {} }
      case 'tools/list':
        return { result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } }
      case 'tools/call': {
        const tool = tools.find((t) => t.name === p.name)
        if (tool === undefined) return { error: { code: -32602, message: `Unknown tool: ${String(p.name).slice(0, 80)}` } }
        this.deps.onToolCall(residentId, tool.name, p.arguments)
        try {
          const out = await tool.call(p.arguments, { residentId, space: this.deps.spaceOf(residentId) }, this.deps.tools)
          return { result: { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) } }
        } catch (e) {
          return { result: { content: [{ type: 'text', text: errorMessage(e) }], isError: true } }
        }
      }
      default:
        return { error: { code: -32601, message: `Method not found: ${method.slice(0, 80)}` } }
    }
  }
}

const rpcError = (id: JsonRpcId, error: RpcError): unknown => ({ jsonrpc: '2.0', id, error })

function json(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

/** A status with no body. The request is drained first, so a client still sending gets the answer rather than a reset. */
function plain(res: ServerResponse, status: number, req: IncomingMessage, headers: Record<string, string> = {}): void {
  const send = (): void => { res.writeHead(status, { ...headers, Connection: 'close' }).end() }
  if (req.complete) { send(); return }
  req.once('end', send)
  req.resume()
}

/** The body as text, or null once it passes `MAX_BODY` (the rest is read and dropped). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { resolve(null); return }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY) chunks.push(chunk)
    })
    req.on('end', () => { resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')) })
    req.on('error', () => { resolve(null) })
  })
}
