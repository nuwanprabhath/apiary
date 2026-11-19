import type { SessionDriver } from '../driving/sessionDriver'
import type { ResidentService } from '../residents/residentService'
import type { SlackBridge } from '../slack/slackBridge'
import { slackDesk } from './slackDesk'

/** What every desk piece works over: the Slack connection, the session driver and the residents. */
export interface DeskParts {
  bridge: SlackBridge
  driver: SessionDriver
  residents: ResidentService
}

/** One piece of the desk: it hangs its handlers and listeners on the parts and returns how to remove them. */
export type DeskPiece = (parts: DeskParts) => () => void

/** Every piece, started in this order. */
const DESK_PIECES: readonly DeskPiece[] = [slackDesk]

/**
 * Starts every desk piece, then the Slack poller, so no message arrives before something can take
 * it. The returned function stops the poller, then removes the pieces, last first.
 */
export function startDesk(parts: DeskParts): () => Promise<void> {
  const stops = DESK_PIECES.map((piece) => piece(parts))
  const stopBridge = parts.bridge.start()
  return async () => {
    await stopBridge()
    for (const stop of stops.reverse()) stop()
  }
}
