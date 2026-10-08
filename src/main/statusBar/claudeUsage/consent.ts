/**
 * The user's answer to "may Apiary read Claude Code's sign-in token to show your usage?".
 *
 * Reading another program's credential, and sending it to a third party, is something the user
 * agrees to once, not something that happens because a plugin is switched on. So the two functions
 * that do it (`readAccessToken` in credentials.ts, `fetchLimits` in limits.ts) take a `Consent`
 * as a parameter, and the only way to get one is `ConsentStore.proof()`, which answers only after
 * the user said yes. A call site that forgot to ask does not compile (ADR-0019), and the
 * `apiary/consent-minted-by-store` rule stops a cast from minting one anywhere else.
 */

/** What the user has answered. `unknown` is "not asked yet", and is the state of every install
 *  that has not seen the prompt, including ones that ran the plugin before the prompt existed. */
export type ConsentState = 'unknown' | 'granted' | 'declined'

declare const grantedBrand: unique symbol

/** Proof that the user agreed. Obtained only from `ConsentStore.proof()`. */
export interface Consent {
  readonly [grantedBrand]: true
}

/** Where the answer is remembered between launches (main's settings file; a variable in tests). */
export interface ConsentStorage {
  load(): ConsentState
  save(state: ConsentState): void
}

/** A store held in memory only: the default when nothing persists, and what tests use. */
export function memoryConsentStorage(initial: ConsentState = 'unknown'): ConsentStorage {
  let state = initial
  return { load: () => state, save: (next) => { state = next } }
}

export class ConsentStore {
  constructor(private readonly storage: ConsentStorage) {}

  state(): ConsentState {
    return this.storage.load()
  }

  grant(): void {
    this.storage.save('granted')
  }

  decline(): void {
    this.storage.save('declined')
  }

  /** Back to "not asked": the next use asks again. */
  reset(): void {
    this.storage.save('unknown')
  }

  /** The proof the credential functions require; `undefined` until the user has agreed. */
  proof(): Consent | undefined {
    return this.state() === 'granted' ? ({} as Consent) : undefined
  }
}
