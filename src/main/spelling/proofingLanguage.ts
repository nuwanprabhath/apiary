export const SYSTEM_PROOFING_LANGUAGE = 'system'

/** The saved language if this machine has a dictionary for it; else the system's, then en-US, then the first available. */
export function resolveProofingLanguage(
  saved: string,
  available: readonly string[],
  systemLocales: readonly string[],
): string | null {
  if (available.length === 0) return null
  if (saved !== SYSTEM_PROOFING_LANGUAGE && available.includes(saved)) return saved
  for (const locale of systemLocales) {
    if (available.includes(locale)) return locale
    const language = primaryLanguage(locale)
    const sameLanguage = available.find((code) => primaryLanguage(code) === language)
    if (sameLanguage !== undefined) return sameLanguage
  }
  return available.find((code) => code === 'en-US') ?? available[0]
}

function primaryLanguage(code: string): string {
  return code.split('-')[0].toLowerCase()
}
