import { request } from 'node:http'
import { ignoreErrors } from '@shared/ignoreErrors'

/**
 * A sign-in page's callback, relayed between machines. Claude Code's sign-in link (`$BROWSER`)
 * sends the browser back to `http://localhost:<port>/callback`, a server `claude` runs on the work
 * machine. A remote window opens the link on the home machine, whose browser can reach only its own
 * localhost, so home listens on that port for a while (`linkBridge.ts`) and relays each request over
 * the connection; the work machine makes it to its own localhost here.
 */

/** How long a link's callback port stays open to a relay, on either machine. */
export const CALLBACK_WINDOW_MS = 10 * 60_000
const FETCH_TIMEOUT_MS = 10_000
const MAX_CALLBACK_BODY = 1024 * 1024

/** What a relayed request answered: enough for a browser to show it or follow its redirect. */
export interface CallbackResponse {
  status: number
  location: string | null
  contentType: string | null
  /** The body, base64. */
  body: string
}

/** The localhost port a link's `redirect_uri` sends the browser back to, or null. */
export function callbackPortOf(link: string): number | null {
  const url = ignoreErrors(() => new URL(link), 'a link that is no URL has no callback')
  const redirect = url?.searchParams.get('redirect_uri')
  if (redirect === null || redirect === undefined) return null
  const back = ignoreErrors(() => new URL(redirect), 'a redirect that is no URL has no callback')
  if (back === undefined || back.protocol !== 'http:' || (back.hostname !== 'localhost' && back.hostname !== '127.0.0.1')) return null
  const port = Number(back.port)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/**
 * The ports a relay may reach on this machine: only those of links its own terminals asked to open
 * in the last `CALLBACK_WINDOW_MS`, so a client cannot use the relay to probe other local servers.
 */
export class CallbackPorts {
  /** Port to when it stops being reachable. Invalidated by the clock (`CALLBACK_WINDOW_MS`). */
  private readonly until = new Map<number, number>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Records the callback port of a link a terminal asked to open, if it has one. */
  note(link: string): void {
    const port = callbackPortOf(link)
    if (port !== null) this.until.set(port, this.now() + CALLBACK_WINDOW_MS)
  }

  allows(port: number): boolean {
    const until = this.until.get(port)
    if (until === undefined) return false
    if (until > this.now()) return true
    this.until.delete(port)
    return false
  }
}

/** Makes a relayed GET to `http://127.0.0.1:<port><path>`, and answers what came back. */
export function fetchCallback(port: number, path: string): Promise<CallbackResponse> {
  return new Promise((resolve, reject) => {
    if (!path.startsWith('/')) { reject(new Error('A callback path starts with /')); return }
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: FETCH_TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_CALLBACK_BODY) { req.destroy(new Error('The callback answered too much')); return }
        chunks.push(chunk)
      })
      res.on('end', () => {
        const header = (name: string): string | null => {
          const value = res.headers[name]
          return typeof value === 'string' ? value : null
        }
        resolve({ status: res.statusCode ?? 502, location: header('location'), contentType: header('content-type'), body: Buffer.concat(chunks).toString('base64') })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => { req.destroy(new Error('The callback did not answer')) })
    req.on('error', reject)
    req.end()
  })
}
