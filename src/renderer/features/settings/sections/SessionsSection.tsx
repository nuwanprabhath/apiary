import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { NumberSetting } from '../fields/NumberSetting'

/** Check-interval presets, in minutes. */
const INTERVAL_PRESETS = [1, 5, 15, 30, 60]

export function SessionsSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  const intervalEnabled = draft.autoImportIntervalMinutes !== null

  return (
    <>
      <CheckboxSetting
        testId="setting-auto-import-all"
        checked={draft.autoImportAll}
        onChange={(checked) => { patch({ autoImportAll: checked }) }}
        label="Automatically import all sessions"
        help={(
          <>
            Every session Apiary discovers is imported without being picked by hand —
            on startup, and whenever it rescans. The import dialog stays available, but
            there will be nothing left in it to choose.
          </>
        )}
      />

      <CheckboxSetting
        testId="setting-auto-import-interval-enabled"
        checked={intervalEnabled}
        onChange={(checked) => { patch({ autoImportIntervalMinutes: checked ? 5 : null }) }}
        label="Check for new sessions periodically"
        help={(
          <>
            Apiary already notices session files as they change. This is for the rest:
            a session you start in a terminal outside the app shows up on its own,
            rather than only when you press Refresh.
          </>
        )}
      />

      {intervalEnabled && (
        <div className="settings-row settings-row-indent">
          <NumberSetting
            testId="setting-auto-import-interval"
            label="Every"
            unit="minutes"
            min={1}
            max={1440}
            value={draft.autoImportIntervalMinutes ?? 5}
            onChange={(n) => { patch({ autoImportIntervalMinutes: n }) }}
            presets={INTERVAL_PRESETS.map((m) => ({
              value: m, testId: `setting-interval-preset-${String(m)}`, label: `${String(m)}m`,
            }))}
          />
        </div>
      )}
    </>
  )
}
