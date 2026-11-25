import type { PrivacyFeature } from '@shared/domain/privacy'
import type { ResidentStatus } from '@shared/domain/residents'

/** The part of the privacy gate residents ask (`privacy/privacyGate.ts`). */
export interface ResidentGate {
  allows(feature: PrivacyFeature): boolean
  onChange(listener: () => void): () => void
}

/** A missing gate allows everything; one that throws allows nothing. */
export function gateAllows(gate: ResidentGate | undefined, feature: PrivacyFeature): boolean {
  try {
    return gate?.allows(feature) ?? true
  } catch {
    return false
  }
}

/** Why the digest is held: no consent first, then the usage limit. */
export function digestPausedFor(gate: ResidentGate | undefined, overUsage: boolean): ResidentStatus['digestPaused'] {
  if (!gateAllows(gate, 'backgroundDigest')) return 'consent'
  return overUsage ? 'usage' : null
}
