import type { SlackConfigChange, SlackStatus } from '@shared/domain/slack'
import { createIpcStore } from './createIpcStore'

/**
 * Main's Slack connection (`main/slack/slackBridge.ts`), with the bot token never in it (only
 * `hasToken`). Every change main makes is pushed whole as `slackChanged`. `null` until the first answer.
 */
const slackStore = createIpcStore<SlackStatus | null>({
  scope: 'slack',
  initial: null,
  fetch: () => window.apiary.slackStatus(),
  subscribe: (push) => window.apiary.onSlackChanged(push),
})

export function useSlack(): SlackStatus | null {
  return slackStore.useStore()
}

/**
 * Saves a change at once. Returned (policy 3): the section shows a refusal under the field and the
 * status line shows the bridge's own error, so the caller catches it. The new status reaches the
 * store through `slackChanged`.
 */
export async function configureSlack(change: SlackConfigChange): Promise<void> {
  await window.apiary.slackConfigure(change)
}

/** Asks main to try the connection now; the answer arrives as `slackChanged`. */
export async function testSlack(): Promise<void> {
  await window.apiary.slackTest()
}
