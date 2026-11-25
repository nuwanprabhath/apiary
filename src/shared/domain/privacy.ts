import { isRecord } from '../guards'
import type { Guard } from '../ipc/guards'

/** Each automatic processing that strict mode holds until the user agrees to it. */
export const PRIVACY_FEATURES = [
  'backgroundDigest',
  'residentCycles',
  'slackBridge',
  'gitlabLookups',
  'spellDictionaries',
] as const
export type PrivacyFeature = (typeof PRIVACY_FEATURES)[number]

export interface PrivacyConsent {
  /** Epoch ms. */
  grantedAt: number
  /** `migrated`: the feature was already on before strict mode existed. */
  source: 'user' | 'migrated'
}
export type PrivacyConsents = Partial<Record<PrivacyFeature, PrivacyConsent>>

export interface PrivacyDisclosure {
  label: string
  recipient: string
  sends: string
  when: string
}

/** One line per recipient, shown in Settings → Privacy and in each consent dialog. */
export const PRIVACY_DISCLOSURES: Record<PrivacyFeature, PrivacyDisclosure> = {
  backgroundDigest: {
    label: 'Background topic summaries',
    recipient: 'Anthropic',
    sends: "the text of your Claude Code sessions (your messages and Claude's replies), about 40,000 characters at a time, to write topic summaries",
    when: 'in the background while Regent is on duty',
  },
  residentCycles: {
    label: 'Scheduled resident checks',
    recipient: 'Anthropic',
    sends: "a resident's check-in prompt and what it reads for it, such as merge request titles, descriptions, comments and their authors' names",
    when: "on the resident's own schedule, without you starting it",
  },
  slackBridge: {
    label: 'Slack connection',
    recipient: 'Slack',
    sends: 'the messages you send Regent from Slack, and its replies with excerpts of your sessions and their progress',
    when: 'every few seconds while the Slack connection is on',
  },
  gitlabLookups: {
    label: 'GitLab merge request status',
    recipient: 'your GitLab server',
    sends: 'the repository and branch name of each session you open, to look up its merge request',
    when: 'when a session with a GitLab remote is shown',
  },
  spellDictionaries: {
    label: 'Spelling dictionaries (Linux)',
    recipient: 'Google',
    sends: "a request for your language's dictionary, which reveals your IP address and language",
    when: 'once, the first time spelling is checked on Linux',
  },
}

export const isPrivacyFeature: Guard<PrivacyFeature> = (v): v is PrivacyFeature =>
  PRIVACY_FEATURES.some((f) => f === v)

const isPrivacyConsent = (v: unknown): v is PrivacyConsent =>
  isRecord(v)
  && typeof v.grantedAt === 'number' && Number.isFinite(v.grantedAt) && v.grantedAt > 0
  && (v.source === 'user' || v.source === 'migrated')

/**
 * True for any plain record: the stored consents are never thrown away whole for one bad or
 * unknown entry (a newer build's feature, a hand edit). `cleanPrivacyConsents` drops those.
 */
export const isPrivacyConsents: Guard<PrivacyConsents> = (v): v is PrivacyConsents =>
  isRecord(v) && !Array.isArray(v)

/** Keeps only known features with a well-formed consent. */
export function cleanPrivacyConsents(v: unknown): PrivacyConsents {
  if (!isRecord(v)) return {}
  const out: PrivacyConsents = {}
  for (const feature of PRIVACY_FEATURES) {
    const entry = v[feature]
    if (isPrivacyConsent(entry)) out[feature] = { grantedAt: entry.grantedAt, source: entry.source }
  }
  return out
}

/** The one rule: strict off means allowed; strict on means allowed only with a consent. */
export function privacyAllows(strict: boolean, consents: PrivacyConsents, feature: PrivacyFeature): boolean {
  return !strict || consents[feature] !== undefined
}

export interface PurgeRequest {
  /** search.db: cleared and rebuilt. */
  searchIndex: boolean
  /** knowledge.db digests. */
  digests: boolean
  logs: boolean
  /** residents/*\/history.json, notes.json, MR desk state. */
  residentHistory: boolean
  /** slack.json tasks and awaiting (keeps token, channel, owner). */
  slackMessages: boolean
  pastedImages: boolean
  /** scheduled/*.log and *.done, never a pending message. */
  scheduledLogs: boolean
  /** apiary.db renames, notes, archived rows. */
  sessionMetadata: boolean
}

const PURGE_ITEMS = [
  'searchIndex', 'digests', 'logs', 'residentHistory', 'slackMessages', 'pastedImages', 'scheduledLogs', 'sessionMetadata',
] as const satisfies readonly (keyof PurgeRequest)[]

export interface PurgeResult {
  removedBytes: number
  failed: { item: keyof PurgeRequest; reason: string }[]
}

/** Every item a boolean, and nothing else. */
export const isPurgeRequest: Guard<PurgeRequest> = (v): v is PurgeRequest =>
  isRecord(v)
  && Object.keys(v).length === PURGE_ITEMS.length
  && PURGE_ITEMS.every((k) => typeof v[k] === 'boolean')

/** A request for nothing, to set the items one feature produced on. */
const NO_PURGE: PurgeRequest = Object.freeze({
  searchIndex: false, digests: false, logs: false, residentHistory: false,
  slackMessages: false, pastedImages: false, scheduledLogs: false, sessionMetadata: false,
})

/** What withdrawing a feature's consent offers to delete with it. */
export function purgeFor(feature: PrivacyFeature): PurgeRequest | null {
  if (feature === 'backgroundDigest') return { ...NO_PURGE, digests: true }
  if (feature === 'slackBridge') return { ...NO_PURGE, slackMessages: true }
  return null
}

export type UsageConsentAnswer = 'allowed' | 'denied' | 'unasked'

export interface PrivacyStatus {
  strict: boolean
  consents: PrivacyConsents
  disclosures: Record<PrivacyFeature, PrivacyDisclosure>
  retentionDays: number
  usageConsent: UsageConsentAnswer
}

