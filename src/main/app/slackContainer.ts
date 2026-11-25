import { powerMonitor } from 'electron'
import { IPC } from '@shared/api'
import { migrateSlackConsent } from '../slack/slackConsent'
import { safeStorageCipher } from '../remote/safeStorageCipher'
import { SlackBridge } from '../slack/slackBridge'
import { createSlackApi, type SlackApi } from '../slack/slackApi'
import { SlackStore, type CodeCipher } from '../slack/slackStore'
import { broadcast } from '../windows/broadcast'
import type { ContainerPaths } from './containerPaths'
import type { RuntimeEnv } from './env'
import type { PrivacyGate } from '../privacy/privacyGate'

const SLACK_API_URL = 'https://slack.com/api'

/**
 * The Slack connection: its store (`slack.json`, the token encrypted by the keychain `cipher`),
 * Slack's Web API over `fetch` (or `api`, a stand-in for a test) and the bridge. Nothing polls
 * until `index.ts` calls `bridge.start()`. Built by `createContainer` and the contract loopback alike.
 */
export function createSlack(o: {
  paths: Pick<ContainerPaths, 'slackFile'>
  env: Pick<RuntimeEnv, 'slackApi'>
  /** Null where there is no keychain at all: a token is then refused. */
  cipher: CodeCipher | null
  /** Calls its argument when the machine wakes from sleep. */
  onResume: (poll: () => void) => () => void
  fetch?: typeof fetch
  api?: SlackApi
  /** What the bridge asks before it polls or posts. Omitted in a test without settings. */
  privacyGate?: PrivacyGate
}): SlackBridge {
  const store = new SlackStore(o.paths.slackFile, o.cipher)
  const api = o.api ?? createSlackApi({ fetch: o.fetch ?? fetch, baseUrl: o.env.slackApi ?? SLACK_API_URL, token: () => store.token() })
  migrateSlackConsent(store, o.privacyGate)
  const bridge = new SlackBridge({ store, api, onResume: o.onResume, ...(o.privacyGate !== undefined ? { gate: o.privacyGate } : {}) })
  bridge.onChanged((status) => { broadcast(IPC.slackChanged, status) })
  return bridge
}

/** The app's own Slack: the OS keychain for the token, and Electron's wake-from-sleep event. */
export function createAppSlack(paths: Pick<ContainerPaths, 'slackFile'>, env: Pick<RuntimeEnv, 'slackApi'>, privacyGate?: PrivacyGate): SlackBridge {
  return createSlack({
    paths, env, cipher: safeStorageCipher(), privacyGate,
    onResume: (poll) => { powerMonitor.on('resume', poll); return () => { powerMonitor.off('resume', poll) } },
  })
}
