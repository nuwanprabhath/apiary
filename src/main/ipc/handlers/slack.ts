import type { SlackBridge } from '../../slack/slackBridge'
import type { Handlers } from '../registrar'

type HandledKeys = 'slackStatus' | 'slackConfigure' | 'slackTest'

/** The guard checked the shapes (token, channel and member id); the bridge saves, connects and tells every window. */
export function slackHandlers(slack: SlackBridge | null): Pick<Handlers, HandledKeys> {
  const bridge = (): SlackBridge => {
    if (slack === null) throw new Error('Slack is not available here.')
    return slack
  }
  return {
    slackStatus: () => bridge().status(),
    slackConfigure: (_e, change) => bridge().configure(change),
    slackTest: () => bridge().test(),
  }
}
