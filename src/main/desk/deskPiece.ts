import type { SessionId } from '@shared/domain/ids'
import type { RepoWebLocation } from '@shared/mentions/repoWebLocation'
import type { SessionDriver } from '../driving/sessionDriver'
import type { ResidentService } from '../residents/residentService'
import type { SlackBridge } from '../slack/slackBridge'

/** Where the desk's `#12` and `!34` can point. */
export interface DeskRepos {
  /** The web page of a session's repository, from its `origin` remote. */
  ofSession(sessionId: SessionId): Promise<RepoWebLocation | null>
  /** The MR desk's configured GitLab project, or null with none. */
  mrDesk(): RepoWebLocation | null
}

/** What every desk piece works over: the Slack connection, the session driver, the residents and the repositories. */
export interface DeskParts {
  bridge: SlackBridge
  driver: SessionDriver
  residents: ResidentService
  repos: DeskRepos
}

/** One piece of the desk: it hangs its handlers and listeners on the parts and returns how to remove them. */
export type DeskPiece = (parts: DeskParts) => () => void
