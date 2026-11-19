import type { SessionDriver } from '../driving/sessionDriver'
import type { ResidentService } from '../residents/residentService'
import type { SlackBridge } from '../slack/slackBridge'

/** What every desk piece works over: the Slack connection, the session driver and the residents. */
export interface DeskParts {
  bridge: SlackBridge
  driver: SessionDriver
  residents: ResidentService
}

/** One piece of the desk: it hangs its handlers and listeners on the parts and returns how to remove them. */
export type DeskPiece = (parts: DeskParts) => () => void
