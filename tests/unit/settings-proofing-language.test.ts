import { describe, it, expect } from 'vitest'
import { SETTINGS, mergePayload, settingsDefaults, type AppSettingsPayload } from '@shared/settings/schema'

describe('Proofing language setting', () => {
  it('should have proofingLanguage in SETTINGS', () => {
    expect(SETTINGS.proofingLanguage).toBeDefined()
  })

  it('should default to the system language', () => {
    const defaults = settingsDefaults()
    expect(defaults.proofingLanguage).toBe('system')
  })

  it('should accept valid language codes', () => {
    const current = settingsDefaults()
    const result = mergePayload(current, { proofingLanguage: 'fr-FR' }, { knownPluginIds: new Set(), isAbsolutePath: () => false })
    expect(result.merged.proofingLanguage).toBe('fr-FR')
    expect(result.rejected).not.toContain('proofingLanguage')
  })

  it('should reject non-string values', () => {
    const current = settingsDefaults()
    const result = mergePayload(current, { proofingLanguage: 123 as unknown as string }, { knownPluginIds: new Set(), isAbsolutePath: () => false })
    expect(result.rejected).toContain('proofingLanguage')
    expect(result.merged.proofingLanguage).toBe('system')
  })

  it('should preserve current value on invalid input', () => {
    const current: AppSettingsPayload = { ...settingsDefaults(), proofingLanguage: 'de-DE' }
    const result = mergePayload(current, { proofingLanguage: null as unknown as string }, { knownPluginIds: new Set(), isAbsolutePath: () => false })
    expect(result.merged.proofingLanguage).toBe('de-DE')
  })

  it('should allow omitting proofingLanguage in merge (unchanged)', () => {
    const current: AppSettingsPayload = { ...settingsDefaults(), proofingLanguage: 'es-ES' }
    const result = mergePayload(current, {}, { knownPluginIds: new Set(), isAbsolutePath: () => false })
    expect(result.merged.proofingLanguage).toBe('es-ES')
  })
})
