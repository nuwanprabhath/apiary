import { createServer, type Server } from 'node:http'
import { log } from '../log/logger'
import { webUrl } from '@shared/webUrl'
import { CALLBACK_WINDOW_MS, callbackPortOf, type CallbackResponse } from './signInCallback'

/** The work machine, as far as a relayed callback needs it. */
export interface CallbackConnection {
  callback(w: number, port: number, path: string): Promise<CallbackResponse>
}

export interface LinkBridgeDeps {
  /** This machine's browser (`shell.openExternal`). */
  openExternal: (url: string) => Promise<void>
  /** How long a relay listens before it gives up. */
  windowMs?: number
}

/** Opens a remote terminal's link at home (`openTerminalLink`, `bridged` scope). */
export type LinkBridge = (url: string, w: number, connection: CallbackConnection) => Promise<void>

/**
 * Opens a link a work machine's terminal asked for in this machine's browser. When the link is a
 * sign-in page that sends the browser back to `localhost:<port>` (Claude Code's), this machine
 * listens on that port first and relays the callback to the work machine (`signInCallback.ts`), so
 * the sign-in finishes there with nothing to paste. A port already taken here leaves the link to
 * open as it is: the page's own fallback (a code to paste) still works.
 */
export function createLinkBridge(deps: LinkBridgeDeps): LinkBridge {
  const relays = new Map<number, Server>()
  return async (text, w, connection) => {
    const url = webUrl(text)
    if (url === null) return
    const port = callbackPortOf(url)
    if (port !== null && !relays.has(port)) {
      const relay = await listenOnce(port, w, connection, deps.windowMs ?? CALLBACK_WINDOW_MS, () => { relays.delete(port) })
      if (relay !== null) relays.set(port, relay)
    }
    await deps.openExternal(url)
  }
}

/** Listens on `127.0.0.1:<port>` and relays each request until one is answered without an error, or time runs out; null when the port is taken. */
function listenOnce(port: number, w: number, connection: CallbackConnection, windowMs: number, onClosed: () => void): Promise<Server | null> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url === undefined) { res.writeHead(405).end(); return }
      connection.callback(w, port, req.url).then((answer) => {
        const headers: Record<string, string> = {}
        if (answer.location !== null) headers.location = answer.location
        if (answer.contentType !== null) headers['content-type'] = answer.contentType
        res.writeHead(answer.status, headers).end(Buffer.from(answer.body, 'base64'))
        if (answer.status < 400) close()
      }, (error: unknown) => {
        log.warn('remote', 'a sign-in callback could not be relayed', { port, error: String(error) })
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('Apiary could not reach the sign-in on the work machine.')
      })
    })
    const timer = setTimeout(close, windowMs)
    function close(): void {
      clearTimeout(timer)
      server.close()
      onClosed()
    }
    server.once('error', () => { clearTimeout(timer); onClosed(); resolve(null) })
    server.listen(port, '127.0.0.1', () => { log.info('remote', 'relaying a sign-in callback', { port }); resolve(server) })
  })
}
