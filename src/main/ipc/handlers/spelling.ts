import type { SpellingService } from '../../spelling/spellingService'
import type { Handlers } from '../registrar'

type HandledKeys = 'spellingGetLanguages' | 'spellingSetLanguage'

export function spellingHandlers(spellingService: SpellingService): Pick<Handlers, HandledKeys> {
  return {
    async spellingGetLanguages(): Promise<string[]> {
      return spellingService.getAvailableLanguages()
    },

    async spellingSetLanguage(_e, language: string): Promise<void> {
      spellingService.setLanguage(language)
    },
  }
}
