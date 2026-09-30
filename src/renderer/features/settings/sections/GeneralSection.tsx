import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { CheckboxSetting } from '../fields/CheckboxSetting'

export function GeneralSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  return (
    <>
    <label className="settings-row settings-row-stacked">
      <strong>Path to the claude binary</strong>
      <input
        className="search"
        data-testid="claude-bin-input"
        placeholder="Leave empty to use PATH"
        value={draft.claudeBin ?? ''}
        onChange={(e) => { patch({ claudeBin: e.target.value }) }}
      />
      <span className="settings-help">
        Set this only if resuming fails with &quot;claude: command not found&quot;. Run
        <code> which claude </code> in your shell to find it.
      </span>
    </label>
    <CheckboxSetting
      testId="setting-system-title-bar"
      checked={draft.systemTitleBar}
      onChange={(checked) => { patch({ systemTitleBar: checked }) }}
      label="Use the system title bar"
      help={(
        <>
          Apiary draws its own title bar and menus in the theme&apos;s colours. Turn this on to use
          the operating system&apos;s instead — for a window manager that does not get on with a
          custom title bar. Applies to windows opened after the change; restart Apiary to apply it
          to this one.
        </>
      )}
    />
    </>
  )
}
