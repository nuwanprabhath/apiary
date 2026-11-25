import { app, session } from 'electron'
import type { PrivacyFeature } from '@shared/domain/privacy'
import { resolveProofingLanguage, SYSTEM_PROOFING_LANGUAGE } from './proofingLanguage'

export interface SpellingDeps {
  /** Settings → Privacy: on Linux the dictionaries are fetched from Google, so none is set until it allows `spellDictionaries`. */
  privacyGate?: { allows(feature: PrivacyFeature): boolean; onChange(listener: () => void): () => void }
  platform?: NodeJS.Platform
}

/** The spellcheck language is per session, so setting it once changes every window. */
export class SpellingService {
  private saved = SYSTEM_PROOFING_LANGUAGE

  constructor(private readonly deps: SpellingDeps = {}) {}

  /** Applies the saved setting at startup; one this machine has no dictionary for falls back to the system's. */
  restore(saved: string): void {
    this.saved = saved
    this.deps.privacyGate?.onChange(() => { this.apply(this.saved) })
    this.apply(saved)
  }

  getAvailableLanguages(): string[] {
    return [...session.defaultSession.availableSpellCheckerLanguages].sort()
  }

  setLanguage(language: string): void {
    if (language !== SYSTEM_PROOFING_LANGUAGE && !this.getAvailableLanguages().includes(language)) {
      throw new Error(`No spellcheck dictionary for ${language}`)
    }
    this.saved = language
    this.apply(language)
  }

  /** A gate that throws counts as not allowed. macOS checks with the system's own dictionaries and is never held. */
  private held(): boolean {
    if ((this.deps.platform ?? process.platform) !== 'linux') return false
    try {
      return !(this.deps.privacyGate?.allows('spellDictionaries') ?? true)
    } catch {
      return true
    }
  }

  private apply(saved: string): void {
    if (this.held()) { session.defaultSession.setSpellCheckerLanguages([]); return }
    const resolved = resolveProofingLanguage(saved, this.getAvailableLanguages(), [app.getSystemLocale(), app.getLocale()])
    if (resolved !== null) session.defaultSession.setSpellCheckerLanguages([resolved])
  }
}
