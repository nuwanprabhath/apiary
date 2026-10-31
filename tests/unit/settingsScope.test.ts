import { describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc/contract'
import { SETTINGS, SCREEN_SETTING_KEYS, machinePayload, type SettingKey } from '@shared/settings/schema'

// A remote window's Settings shows the work machine's `machine` settings; the `screen` ones (how this
// screen looks) are never sent there. Each key says which it is, so a new one has to choose.
describe('setting scopes', () => {
  const keys = Object.keys(SETTINGS) as SettingKey[]

  it.each(keys)('%s declares machine or screen', (key) => {
    expect(['machine', 'screen']).toContain(SETTINGS[key].scope)
  })

  it('the look of this screen is screen-scoped, and nothing else is', () => {
    expect([...SCREEN_SETTING_KEYS].sort()).toEqual(['busyAnimation', 'busyAnimationColor', 'motion', 'proofingLanguage', 'systemTitleBar'])
  })

  it('machinePayload keeps only the machine keys', () => {
    const picked = machinePayload({ motion: 'reduced', recentSectionHours: 5, residents: [] })
    expect(picked).toEqual({ recentSectionHours: 5, residents: [] })
  })

  it('machineSettingsSet refuses a patch naming a screen key, and takes one of machine keys', () => {
    expect(IPC.machineSettingsSet.args([{ recentSectionHours: 5, motion: 'reduced' }])).toBe(false)
    expect(IPC.machineSettingsSet.args([{ proofingLanguage: 'fr-FR' }])).toBe(false)
    expect(IPC.machineSettingsSet.args([{ recentSectionHours: 5, residents: [] }])).toBe(true)
    expect(IPC.machineSettingsSet.args(['not an object'])).toBe(false)
  })
})
