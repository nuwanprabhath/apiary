import type { DeskParts, DeskPiece } from './deskParts'
import { slackDesk } from './slackDesk'

export type { DeskParts }

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
