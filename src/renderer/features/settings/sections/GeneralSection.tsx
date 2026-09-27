import type { JSX } from 'react'
import type { AppSettingsPayload } from '@shared/api'

export function GeneralSection(
  { draft, patch }: { draft: AppSettingsPayload; patch: (fields: Partial<AppSettingsPayload>) => void },
): JSX.Element {
  return (
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
  )
}
