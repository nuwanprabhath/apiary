import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { CheckboxSetting } from '../fields/CheckboxSetting'
import { NumberSetting } from '../fields/NumberSetting'

export function SidebarSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  return (
    <>
      <CheckboxSetting
        testId="setting-reveal-active"
        checked={draft.revealActiveInSidebar}
        onChange={(checked) => { patch({ revealActiveInSidebar: checked }) }}
        label="Reveal the open session in the sidebar"
        help={(
          <>
            Switching to a tab scrolls the sidebar to that session and highlights it, so
            you can see where in months of history the thing you are looking at lives.
            Turn this off to leave the sidebar exactly where you left it.
          </>
        )}
      />

      <CheckboxSetting
        testId="setting-recent-enabled"
        checked={draft.recentSectionEnabled}
        onChange={(checked) => { patch({ recentSectionEnabled: checked }) }}
        label="Show a Recent section"
        help={(
          <>
            Lists sessions worked in recently, below Pinned, so a session you just left is
            one click away without hunting through the tree.
          </>
        )}
      />

      {draft.recentSectionEnabled && (
        <div className="settings-row settings-row-indent">
          <NumberSetting
            testId="setting-recent-hours"
            label="Within the last"
            unit="hours"
            min={1}
            max={168}
            value={draft.recentSectionHours}
            onChange={(n) => { patch({ recentSectionHours: n }) }}
          />
        </div>
      )}
    </>
  )
}
