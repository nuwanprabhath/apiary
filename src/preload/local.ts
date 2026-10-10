/**
 * Local preload-only APIs, not exposed over IPC. Implemented using webFrame APIs that are only
 * available in the preload context. These run synchronously and directly access Electron's APIs.
 */
import { webFrame } from 'electron'

export const localApis = {
  spellingCheck: (word: string): { misspelled: boolean; suggestions: string[] } => {
    const misspelled = webFrame.isWordMisspelled(word)
    const suggestions = misspelled ? webFrame.getWordSuggestions(word) : []
    return { misspelled, suggestions }
  },
}
