import { clockTime, type RemoteClientInfo } from '@shared/domain/remote'
import type { StatusBarPlugin } from './types'

/** Who is connected to this machine over remote access: a `RemoteServer`, as far as the bar needs it. */
export interface RemoteClientsFeed {
  clients(): RemoteClientInfo[]
  subscribe(listener: (clients: RemoteClientInfo[]) => void): () => void
}

const windows = (n: number): string => `${n} window${n === 1 ? '' : 's'}`

/** "home-mac, since 10:12, 2 windows" */
const describeClient = (c: RemoteClientInfo): string => `${c.client}, since ${clockTime(c.connectedAt)}, ${windows(c.windows)}`

/**
 * "1 remote" in the status bar while a home machine is connected to this one (nothing otherwise);
 * hovering lists each, and a click opens Settings → General, where "Disconnect all…" is. Presentation
 * only: the server owns the list.
 */
export function createRemoteClientsPlugin(feed: RemoteClientsFeed | undefined): StatusBarPlugin {
  let stop: (() => void) | null = null
  return {
    id: 'remote-clients',
    name: 'Remote connections',
    description: 'Shows when another Apiary is connected to this machine over SSH.',
    start(ctx) {
      stop?.()
      stop = feed?.subscribe(() => { ctx.changed() }) ?? null
    },
    stop() {
      stop?.()
      stop = null
    },
    items() {
      const clients = feed?.clients() ?? []
      if (clients.length === 0) return []
      return [{
        id: 'connected',
        icon: 'link',
        text: `${clients.length} remote`,
        title: `${clients.length} remote ${clients.length === 1 ? 'machine is' : 'machines are'} connected`,
        tone: 'normal',
        action: { kind: 'settings', section: 'general' },
        detail: [
          { kind: 'heading', text: 'Connected over SSH' },
          { kind: 'table', columns: ['Machine'], rows: clients.map((c) => [describeClient(c)]) },
        ],
      }]
    },
    refresh: () => Promise.resolve(),
  }
}
