import type { ContextMenuRequest, EditCommand } from '@shared/domain/contextMenu'
import { attempt, bestEffort, reportFailure } from './policy'

interface SpellingCheck {
  misspelled: boolean
  suggestions: string[]
}

export async function spellingLanguages(): Promise<string[]> {
  return (await bestEffort(window.apiary.spellingGetLanguages(), 'settings')) ?? []
}

export function setSpellingLanguage(language: string): Promise<boolean> {
  return attempt(window.apiary.spellingSetLanguage(language), 'Could not change the proofing language')
}

export function checkSpelling(word: string): SpellingCheck {
  try {
    return window.apiary.spellingCheck(word)
  } catch (thrown) {
    reportFailure(thrown, 'Could not check the spelling')
    return { misspelled: false, suggestions: [] }
  }
}

export function sendEditCommand(command: EditCommand): void {
  window.apiary.editCommand(command)
}

export const onContextMenuRequested = (cb: (request: ContextMenuRequest) => void): (() => void) =>
  window.apiary.onContextMenuRequested(cb)
