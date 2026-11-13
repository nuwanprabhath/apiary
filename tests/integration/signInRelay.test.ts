import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createLinkBridge, type CallbackConnection } from '../../src/main/remote/linkBridge'
import { fetchCallback } from '../../src/main/remote/signInCallback'

/**
 * Claude Code's sign-in, opened from a remote window: the link sends the browser back to
 * `localhost:<port>` on the work machine. Home listens on that port and relays the request over the
 * connection (`linkBridge.ts`); the work machine makes it to its own localhost (`fetchCallback`).
 * Here both machines are this one: the "work" server is claude's, the relay is home's.
 */
const servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => { s.close(r) }))) })

function listen(server: Server, port = 0): Promise<number> {
  servers.push(server)
  return new Promise((resolve) => { server.listen(port, '127.0.0.1', () => { resolve((server.address() as AddressInfo).port) }) })
}

/** A free port: listened on, then let go. */
async function freePort(): Promise<number> {
  const s = createServer()
  const port = await listen(s)
  await new Promise((r) => { s.close(r) })
  servers.splice(servers.indexOf(s), 1)
  return port
}

const signIn = (port: number): string =>
  `https://claude.com/cai/oauth/authorize?code=true&redirect_uri=${encodeURIComponent(`http://localhost:${String(port)}/callback`)}&state=s`

describe('a sign-in callback relayed from the home machine to the work machine', () => {
  it('reaches claude\'s server on the work machine, and the browser gets its answer, once', async () => {
    const port = await freePort()
    // The work machine: claude's callback server, on another port here since both machines are one.
    const got: string[] = []
    const claude = createServer((req, res) => { got.push(req.url ?? ''); res.writeHead(302, { location: 'https://claude.com/oauth/success' }).end() })
    const claudePort = await listen(claude)
    const connection: CallbackConnection = { callback: (_w, p, path) => { expect(p).toBe(port); return fetchCallback(claudePort, path) } }
    const opened: string[] = []
    const bridge = createLinkBridge({ openExternal: async (url) => { opened.push(url) } })

    await bridge(signIn(port), 1, connection)
    expect(opened).toEqual([signIn(port)])
    // The browser, after Authorize: back to localhost on the home machine.
    const answer = await fetch(`http://127.0.0.1:${String(port)}/callback?code=abc&state=s`, { redirect: 'manual' })
    expect(answer.status).toBe(302)
    expect(answer.headers.get('location')).toBe('https://claude.com/oauth/success')
    expect(got).toEqual(['/callback?code=abc&state=s'])
    // Done: the relay let the port go.
    await expect(fetch(`http://127.0.0.1:${String(port)}/callback`)).rejects.toThrow()
  })

  it('opens the link as it is, with no relay, when the port is taken here', async () => {
    const taken = createServer((_req, res) => { res.end('mine') })
    const port = await listen(taken)
    const opened: string[] = []
    const calls: string[] = []
    const bridge = createLinkBridge({ openExternal: async (url) => { opened.push(url) } })
    await bridge(signIn(port), 1, { callback: async (_w, _p, path) => { calls.push(path); throw new Error('unused') } })
    expect(opened).toEqual([signIn(port)])
    expect(await (await fetch(`http://127.0.0.1:${String(port)}/x`)).text()).toBe('mine')
    expect(calls).toEqual([])
  })

  it('opens nothing for a link that is not a web page', async () => {
    const opened: string[] = []
    await createLinkBridge({ openExternal: async (url) => { opened.push(url) } })('file:///etc/passwd', 1, { callback: () => Promise.reject(new Error('no')) })
    expect(opened).toEqual([])
  })
})
