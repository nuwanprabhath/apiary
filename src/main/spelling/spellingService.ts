import { app, session } from 'electron'
import { resolveProofingLanguage, SYSTEM_PROOFING_LANGUAGE } from './proofingLanguage'

/** The spellcheck language is per session, so setting it once changes every window. */
export class SpellingService {
  /** Applies the saved setting at startup; one this machine has no dictionary for falls back to the system's. */
  restore(saved: string): void {
    this.apply(saved)
  }

  getAvailableLanguages(): string[] {
    return [...session.defaultSession.availableSpellCheckerLanguages].sort()
  }

  setLanguage(language: string): void {
    if (language !== SYSTEM_PROOFING_LANGUAGE && !this.getAvailableLanguages().includes(language)) {
      throw new Error(`No spellcheck dictionary for ${language}`)
    }
    this.apply(language)
  }

  private apply(saved: string): void {
    const resolved = resolveProofingLanguage(saved, this.getAvailableLanguages(), [app.getSystemLocale(), app.getLocale()])
    if (resolved !== null) session.defaultSession.setSpellCheckerLanguages([resolved])
  }
}
