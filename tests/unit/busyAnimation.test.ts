import { describe, it, expect } from 'vitest'
import {
  BUSY_ANIMATION_IDS, BUSY_ANIMATIONS, BUSY_COLOR_IDS, busyColorFor, isBusyAnimationId, isBusyColorId,
} from '@shared/domain/busyAnimation'
import { mergePayload } from '@shared/settings/schema'
import { DEFAULT_SETTINGS_PAYLOAD } from '@shared/settingsDefaults'

describe('working animations', () => {
  it('draws an animation in the chosen colour when it offers it', () => {
    expect(busyColorFor('orbit', 'aurora')).toBe('aurora')
    expect(busyColorFor('spark', 'claude')).toBe('claude')
  })

  it('falls back to the animation\'s own first colour when it does not offer the chosen one', () => {
    const narrow = { ...BUSY_ANIMATIONS.orbit, colors: ['claude'] as const }
    const saved = BUSY_ANIMATIONS.orbit
    BUSY_ANIMATIONS.orbit = narrow
    try {
      expect(busyColorFor('orbit', 'mono')).toBe('claude')
    } finally {
      BUSY_ANIMATIONS.orbit = saved
    }
  })

  it('every animation offers at least one known colour', () => {
    for (const id of BUSY_ANIMATION_IDS) {
      expect(BUSY_ANIMATIONS[id].colors.every((c) => (BUSY_COLOR_IDS as readonly string[]).includes(c))).toBe(true)
    }
  })

  it('the guards accept only the declared ids', () => {
    expect(isBusyAnimationId('orbit')).toBe(true)
    expect(isBusyAnimationId('planets')).toBe(false)
    expect(isBusyColorId('claude')).toBe(true)
    expect(isBusyColorId('#d97757')).toBe(false)
  })

  it('the settings default to the spark in the theme accent, and refuse an unknown animation', () => {
    expect(DEFAULT_SETTINGS_PAYLOAD.busyAnimation).toBe('spark')
    expect(DEFAULT_SETTINGS_PAYLOAD.busyAnimationColor).toBe('theme')
    const ctx = { knownPluginIds: new Set<string>(), isAbsolutePath: () => true }
    const { merged, rejected } = mergePayload(DEFAULT_SETTINGS_PAYLOAD, { busyAnimation: 'planets' as never, busyAnimationColor: 'claude' }, ctx)
    expect(merged.busyAnimation).toBe('spark')
    expect(merged.busyAnimationColor).toBe('claude')
    expect(rejected).toContain('busyAnimation')
  })
})
