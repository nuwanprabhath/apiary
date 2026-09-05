import { useEffect, useState } from 'react'

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [claudeBin, setClaudeBin] = useState('')

  useEffect(() => {
    void window.apiary.settingsGet().then((s) => setClaudeBin(s.claudeBin ?? ''))
  }, [])

  const save = async (): Promise<void> => {
    await window.apiary.settingsSet({ claudeBin: claudeBin.trim() === '' ? null : claudeBin.trim() })
    onClose()
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" data-testid="settings-dialog" role="dialog" aria-modal="true">
        <h2>Settings</h2>
        <label className="field">
          <span>Path to the claude binary</span>
          <input
            className="search"
            data-testid="claude-bin-input"
            placeholder="Leave empty to use PATH"
            value={claudeBin}
            onChange={(e) => setClaudeBin(e.target.value)}
          />
        </label>
        <p className="muted">
          Set this only if resuming fails with &quot;claude: command not found&quot;. Run
          <code> which claude </code> in your shell to find it.
        </p>
        <div className="modal-actions">
          <button data-testid="settings-cancel" onClick={onClose}>Cancel</button>
          <button className="primary" data-testid="settings-save" onClick={() => { void save() }}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
