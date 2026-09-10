import { useEffect, useState } from 'react'
import type { AppSettingsPayload } from '@shared/api'

/**
 * One page of settings. Sections are data, not markup — adding a setting later means adding an
 * entry here and a field in `AppSettingsPayload`, not restructuring the dialog. The nav down the
 * left is generated from this same list, so the two can never disagree about what exists.
 */
interface Section {
  id: string
  label: string
  /** Shown under the section heading, saying what this group of settings is for. */
  blurb: string
}

const SECTIONS: Section[] = [
  { id: 'sessions', label: 'Sessions', blurb: 'How sessions get into Apiary, and how often it looks for new ones.' },
  { id: 'general', label: 'General', blurb: 'Where Apiary finds the tools it runs.' },
]

/** The interval presets, plus the option to type a number. Minutes throughout. */
const INTERVAL_PRESETS = [1, 5, 15, 30, 60]

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<string>(SECTIONS[0].id)
  // Null until the first load resolves; every field below is driven from this one object, so a
  // new setting is a new key rather than another piece of local state to remember to save.
  const [draft, setDraft] = useState<AppSettingsPayload | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void window.apiary.settingsGet().then(setDraft)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const patch = (fields: Partial<AppSettingsPayload>): void => {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...fields }))
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    try {
      await window.apiary.settingsSet({
        ...draft,
        claudeBin: draft.claudeBin?.trim() === '' ? null : draft.claudeBin,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const intervalEnabled = draft?.autoImportIntervalMinutes !== null

  return (
    <div className="modal-backdrop">
      <div className="modal settings-dialog" data-testid="settings-dialog" role="dialog" aria-modal="true">
        <h2>Settings</h2>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className="settings-nav-item"
                data-testid={`settings-nav-${s.id}`}
                data-active={section === s.id}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings-pane" data-testid="settings-pane">
            {draft === null ? (
              <p className="empty">Loading settings…</p>
            ) : section === 'sessions' ? (
              <>
                <p className="settings-blurb">{SECTIONS[0].blurb}</p>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-auto-import-all"
                    checked={draft.autoImportAll}
                    onChange={(e) => patch({ autoImportAll: e.target.checked })}
                  />
                  <span>
                    <strong>Automatically import all sessions</strong>
                    <span className="settings-help">
                      Every session Apiary discovers is imported without being picked by hand —
                      on startup, and whenever it rescans. The import dialog stays available, but
                      there will be nothing left in it to choose.
                    </span>
                  </span>
                </label>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-auto-import-interval-enabled"
                    checked={intervalEnabled}
                    onChange={(e) => patch({ autoImportIntervalMinutes: e.target.checked ? 5 : null })}
                  />
                  <span>
                    <strong>Check for new sessions periodically</strong>
                    <span className="settings-help">
                      Apiary already notices session files as they change. This is for the rest:
                      a session you start in a terminal outside the app shows up on its own,
                      rather than only when you press Refresh.
                    </span>
                  </span>
                </label>

                {intervalEnabled && (
                  <div className="settings-row settings-row-indent">
                    <label className="settings-inline">
                      <span>Every</span>
                      <input
                        className="search settings-number"
                        type="number"
                        min={1}
                        max={1440}
                        data-testid="setting-auto-import-interval"
                        value={draft.autoImportIntervalMinutes ?? 5}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          patch({ autoImportIntervalMinutes: Number.isFinite(n) && n >= 1 ? Math.min(1440, Math.round(n)) : 1 })
                        }}
                      />
                      <span>minutes</span>
                    </label>
                    <div className="settings-presets">
                      {INTERVAL_PRESETS.map((m) => (
                        <button
                          key={m}
                          className="settings-preset"
                          data-testid={`setting-interval-preset-${String(m)}`}
                          data-active={draft.autoImportIntervalMinutes === m}
                          onClick={() => patch({ autoImportIntervalMinutes: m })}
                        >
                          {m}m
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="settings-blurb">{SECTIONS[1].blurb}</p>
                <label className="settings-row settings-row-stacked">
                  <strong>Path to the claude binary</strong>
                  <input
                    className="search"
                    data-testid="claude-bin-input"
                    placeholder="Leave empty to use PATH"
                    value={draft.claudeBin ?? ''}
                    onChange={(e) => patch({ claudeBin: e.target.value })}
                  />
                  <span className="settings-help">
                    Set this only if resuming fails with &quot;claude: command not found&quot;. Run
                    <code> which claude </code> in your shell to find it.
                  </span>
                </label>
              </>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button data-testid="settings-cancel" onClick={onClose}>Cancel</button>
          <button
            className="primary"
            data-testid="settings-save"
            disabled={draft === null || saving}
            onClick={() => { void save() }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
