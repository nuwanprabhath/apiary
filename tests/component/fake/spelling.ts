import type { EditCommand } from '@shared/domain/contextMenu'

/** The words the fake's spell checker flags, and the suggestions it offers for each. */
const MISSPELLINGS = new Map<string, string[]>([
  ['teh', ['the', 'ten', 'tea']],
  ['recieve', ['receive']],
])

export function spellingApi(): {
  spellingGetLanguages: () => Promise<string[]>
  spellingSetLanguage: (language: string) => Promise<void>
  spellingCheck: (word: string) => { misspelled: boolean; suggestions: string[] }
  editCommand: (command: EditCommand) => void
} {
  // Sorted, as main lists them.
  const availableLanguages = ['de-DE', 'en-GB', 'en-US', 'es-ES', 'fr-FR']

  return {
    async spellingGetLanguages(): Promise<string[]> {
      return availableLanguages
    },

    // As main does: 'system' or one of the available languages; anything else is refused.
    async spellingSetLanguage(language: string): Promise<void> {
      if (language !== 'system' && !availableLanguages.includes(language)) {
        throw new Error(`Unknown language: ${language}`)
      }
    },

    spellingCheck(word: string): { misspelled: boolean; suggestions: string[] } {
      const suggestions = MISSPELLINGS.get(word) ?? []
      return { misspelled: suggestions.length > 0, suggestions: [...suggestions] }
    },

    // The edit lands in the window's own field, which the fake does not model; the call is what is recorded.
    editCommand(_command: EditCommand): void {},
  }
}
