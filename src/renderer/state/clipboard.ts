import { attempt, reportFailure } from './policy'

/**
 * Puts text on the clipboard — the one way a component does it. Resolves to whether it worked, and
 * never rejects: a refused write is shown to the user as "Could not copy" (policy 2, `policy.ts`),
 * so the caller only decides what to do on success (`if (await copyText(x)) setCopied(true)`).
 */
export function copyText(text: string): Promise<boolean> {
  return attempt(window.apiary.copyToClipboard(text), 'Could not copy')
}

/** The clipboard's text, for a paste the user asked for; null when it could not be read (shown). */
export async function readClipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText()
  } catch (thrown) {
    reportFailure(thrown, 'Could not read the clipboard')
    return null
  }
}
