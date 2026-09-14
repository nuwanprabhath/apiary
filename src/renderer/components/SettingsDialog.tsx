import { useEffect, useState } from 'react'
import type { AppSettingsPayload, PluginInfoPayload, PluginSettingFieldPayload } from '@shared/api'
import { useUpdate, formatVersion, formatChecked } from '../state/useUpdate'

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
  { id: 'search', label: 'Search', blurb: 'What the search box looks at when you type in it.' },
  { id: 'sidebar', label: 'Sidebar', blurb: 'How the session list behaves while you work.' },
  { id: 'terminal', label: 'Terminal', blurb: 'The shells Apiary starts for a session.' },
  { id: 'plugins', label: 'Plugins', blurb: 'Extras that add a button to the bar under a session.' },
  { id: 'updates', label: 'Updates', blurb: 'How Apiary keeps itself up to date.' },
  { id: 'general', label: 'General', blurb: 'Where Apiary finds the tools it runs.' },
]

/** Check-interval presets, in hours. */
const UPDATE_INTERVAL_PRESETS = [1, 6, 12, 24]

/** The blurb for the section on screen, by id rather than by position in the array. */
const blurbOf = (id: string): string => SECTIONS.find((s) => s.id === id)?.blurb ?? ''

/** The interval presets, plus the option to type a number. Minutes throughout. */
const INTERVAL_PRESETS = [1, 5, 15, 30, 60]

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<string>(SECTIONS[0].id)
  // Null until the first load resolves; every field below is driven from this one object, so a
  // new setting is a new key rather than another piece of local state to remember to save.
  const [draft, setDraft] = useState<AppSettingsPayload | null>(null)
  const [saving, setSaving] = useState(false)
  /** How many sessions are indexed, and whether a rebuild is running — the Search section's state. */
  const [indexed, setIndexed] = useState<number | null>(null)
  const [notesIndexed, setNotesIndexed] = useState<number>(0)
  const [rebuilding, setRebuilding] = useState(false)
  const update = useUpdate()
  /** Set while a check the user pressed for is running, so the button can say so. */
  const [checking, setChecking] = useState(false)
  /** The plugins that exist, as the main process reports them, with their declared settings. */
  const [plugins, setPlugins] = useState<PluginInfoPayload[]>([])
  useEffect(() => {
    void window.apiary.pluginList().then(setPlugins).catch(() => { setPlugins([]) })
  }, [])

  const loadIndexStatus = (): void => {
    void window.apiary.searchStatus()
      .then((s) => { setIndexed(s.indexed); setNotesIndexed(s.notes) })
      .catch(() => setIndexed(null))
  }
  useEffect(loadIndexStatus, [])
  // Indexing runs in the background, so the number this dialog opened with goes stale while it is
  // on screen — showing "0 sessions indexed" indefinitely, on a page whose whole job is to say
  // whether the index exists. The main process announces a finished pass the same way it announces
  // a rescan, so re-read on that.
  useEffect(() => window.apiary.onTreeChanged(loadIndexStatus), [])

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
                <p className="settings-blurb">{blurbOf('sessions')}</p>

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
            ) : section === 'search' ? (
              <>
                <p className="settings-blurb">{blurbOf('search')}</p>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-search-chat-content"
                    checked={draft.searchChatContent}
                    onChange={(e) => patch({ searchChatContent: e.target.checked })}
                  />
                  <span>
                    <strong>Search inside conversations</strong>
                    <span className="settings-help">
                      Matches what was actually said in a session — ticket and merge-request
                      numbers, branch names, pipeline ids, any phrase you remember — not just the
                      session title. Turning this off falls back to titles alone and stops Apiary
                      keeping the index up to date.
                    </span>
                  </span>
                </label>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-search-session-notes"
                    checked={draft.searchSessionNotes}
                    onChange={(e) => patch({ searchSessionNotes: e.target.checked })}
                  />
                  <span>
                    <strong>Search session notes</strong>
                    <span className="settings-help">
                      Notes you write on a session — the ticket you were on, the MR you had open —
                      are matched by the search box too. Turning this off empties the note index;
                      the notes themselves are kept and still show when you hover a session.
                    </span>
                  </span>
                </label>

                <div className="settings-row settings-row-indent">
                  <span className="settings-help" data-testid="search-note-status">
                    {`${String(notesIndexed)} ${notesIndexed === 1 ? 'note' : 'notes'} indexed.`}
                  </span>
                </div>

                <div className="settings-row settings-row-indent">
                  <span className="settings-help" data-testid="search-index-status">
                    {indexed === null
                      ? 'The index is not available.'
                      : `${String(indexed)} ${indexed === 1 ? 'session' : 'sessions'} indexed.`}
                    {' '}Apiary keeps this up to date on its own, reading only what has changed.
                    Rebuild it if results ever look stale.
                  </span>
                  <button
                    data-testid="search-rebuild"
                    disabled={rebuilding || (!draft.searchChatContent && !draft.searchSessionNotes)}
                    onClick={() => {
                      setRebuilding(true)
                      void window.apiary.searchRebuild()
                        .catch(() => {
                          // Nothing to recover: the old index is still in place either way.
                        })
                        .finally(() => { setRebuilding(false); loadIndexStatus() })
                    }}
                  >
                    {rebuilding ? 'Rebuilding…' : 'Rebuild index'}
                  </button>
                </div>
              </>
            ) : section === 'terminal' ? (
              <>
                <p className="settings-blurb">{blurbOf('terminal')}</p>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-terminal-shorten-path"
                    checked={draft.terminalShortenPath}
                    onChange={(e) => patch({ terminalShortenPath: e.target.checked })}
                  />
                  <span>
                    <strong>Shorten the path in the prompt</strong>
                    <span className="settings-help">
                      A worktree path takes most of a narrow terminal&rsquo;s first line before you
                      have typed anything, and the part that identifies it is the end. Apiary asks
                      the shell to keep only the last few folders, leaving the rest of your prompt
                      exactly as you have it.
                    </span>
                  </span>
                </label>

                {draft.terminalShortenPath && (
                  <div className="settings-row settings-row-indent">
                    <label className="settings-inline">
                      <span>Keep the last</span>
                      <input
                        className="search settings-number"
                        type="number"
                        min={1}
                        max={8}
                        data-testid="setting-terminal-path-segments"
                        value={draft.terminalPathSegments}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          patch({
                            terminalPathSegments:
                              Number.isFinite(n) && n >= 1 ? Math.min(8, Math.round(n)) : 1,
                          })
                        }}
                      />
                      <span>folders</span>
                    </label>
                  </div>
                )}

                <div className="settings-row settings-row-indent">
                  <span className="settings-help" data-testid="terminal-shorten-note">
                    Applies to terminals opened from now on — a shell already running keeps the
                    environment it started with. This uses bash&rsquo;s own <code>PROMPT_DIRTRIM</code>,
                    so a zsh prompt is unaffected: zsh has no equivalent, and the alternative is
                    overwriting a prompt you configured yourself.
                  </span>
                </div>
              </>
            ) : section === 'plugins' ? (
              <>
                <p className="settings-blurb">{blurbOf('plugins')}</p>

                {plugins.map((plugin) => {
                  const enabled = draft.plugins[plugin.id] ?? plugin.enabled
                  const values = { ...plugin.values, ...draft.pluginSettings[plugin.id] }
                  const setValue = (key: string, value: string | number | boolean): void => {
                    patch({
                      pluginSettings: {
                        ...draft.pluginSettings,
                        [plugin.id]: { ...values, [key]: value },
                      },
                    })
                  }
                  return (
                    <div className="settings-plugin" key={plugin.id} data-testid={`plugin-${plugin.id}`}>
                      <label className="settings-row">
                        <input
                          type="checkbox"
                          data-testid={`setting-plugin-${plugin.id}`}
                          checked={enabled}
                          onChange={(e) => patch({
                            plugins: { ...draft.plugins, [plugin.id]: e.target.checked },
                          })}
                        />
                        <span>
                          <strong>{plugin.name}</strong>
                          {plugin.description !== null && (
                            <span className="settings-help">{plugin.description}</span>
                          )}
                        </span>
                      </label>

                      {/* A plugin's own settings sit under it, indented, and only while it is on:
                          configuring something switched off is a question nobody asked. */}
                      {enabled && plugin.fields.map((field) => (
                        <PluginField
                          key={field.key}
                          pluginId={plugin.id}
                          field={field}
                          value={values[field.key] ?? field.default}
                          onChange={(value) => setValue(field.key, value)}
                        />
                      ))}
                    </div>
                  )
                })}

                {plugins.length === 0 && <p className="empty">No plugins are installed.</p>}
              </>
            ) : section === 'updates' ? (
              <>
                <p className="settings-blurb">{blurbOf('updates')}</p>

                <div className="settings-row" data-testid="update-version-row">
                  <span className="settings-help">
                    <strong>Version {update === null ? '—' : formatVersion(update.currentVersion)}</strong>
                    <br />
                    Last checked: {formatChecked(update?.lastCheckedAt ?? null)}
                    {update !== null && update.capability.kind !== 'auto' && (
                      <>
                        <br />
                        {update.capability.reason}
                      </>
                    )}
                    {update?.skippedVersion != null && (
                      <>
                        <br />
                        Skipping {formatVersion(update.skippedVersion)}. A newer release than that
                        is still offered.
                      </>
                    )}
                  </span>
                  <button
                    data-testid="update-check-now"
                    disabled={checking || update?.phase === 'checking' || update?.phase === 'downloading'}
                    onClick={() => {
                      setChecking(true)
                      void window.apiary.updateCheck().finally(() => { setChecking(false) })
                    }}
                  >
                    {checking || update?.phase === 'checking' ? 'Checking…' : 'Check now'}
                  </button>
                </div>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-update-automatic"
                    checked={draft.updateAutomaticChecks}
                    onChange={(e) => patch({ updateAutomaticChecks: e.target.checked })}
                  />
                  <span>
                    <strong>Check for updates automatically</strong>
                    <span className="settings-help">
                      Apiary asks GitHub whether there is a newer release, and tells you if there
                      is. Nothing is downloaded or installed without you saying so.
                    </span>
                  </span>
                </label>

                {draft.updateAutomaticChecks && (
                  <div className="settings-row settings-row-indent">
                    <label className="settings-inline">
                      <span>Every</span>
                      <input
                        className="search settings-number"
                        type="number"
                        min={1}
                        max={168}
                        data-testid="setting-update-interval"
                        value={draft.updateCheckIntervalHours}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          patch({
                            updateCheckIntervalHours:
                              Number.isFinite(n) && n >= 1 ? Math.min(168, Math.round(n)) : 1,
                          })
                        }}
                      />
                      <span>hours</span>
                    </label>
                    <div className="settings-presets">
                      {UPDATE_INTERVAL_PRESETS.map((hrs) => (
                        <button
                          key={hrs}
                          className="settings-preset"
                          data-testid={`setting-update-preset-${String(hrs)}`}
                          data-active={draft.updateCheckIntervalHours === hrs}
                          onClick={() => patch({ updateCheckIntervalHours: hrs })}
                        >
                          {hrs}h
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-update-auto-download"
                    checked={draft.updateAutoDownload}
                    onChange={(e) => patch({ updateAutoDownload: e.target.checked })}
                  />
                  <span>
                    <strong>Download updates as soon as they are found</strong>
                    <span className="settings-help">
                      {update?.capability.kind === 'assisted'
                        ? 'The installer is fetched in the background and opened when it is ready, '
                          + 'instead of waiting for you to press Download.'
                        : 'The update is fetched in the background, so installing it is just a '
                          + 'restart. Nothing restarts on its own.'}
                    </span>
                  </span>
                </label>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-update-prerelease"
                    checked={draft.updateAllowPrerelease}
                    onChange={(e) => patch({ updateAllowPrerelease: e.target.checked })}
                  />
                  <span>
                    <strong>Include pre-release versions</strong>
                    <span className="settings-help">
                      Offers beta builds as well as finished releases. Off unless you want to test
                      what is coming next.
                    </span>
                  </span>
                </label>
              </>
            ) : section === 'sidebar' ? (
              <>
                <p className="settings-blurb">{blurbOf('sidebar')}</p>

                <label className="settings-row">
                  <input
                    type="checkbox"
                    data-testid="setting-reveal-active"
                    checked={draft.revealActiveInSidebar}
                    onChange={(e) => patch({ revealActiveInSidebar: e.target.checked })}
                  />
                  <span>
                    <strong>Reveal the open session in the sidebar</strong>
                    <span className="settings-help">
                      Switching to a tab scrolls the sidebar to that session and highlights it, so
                      you can see where in months of history the thing you are looking at lives.
                      Turn this off to leave the sidebar exactly where you left it.
                    </span>
                  </span>
                </label>
              </>
            ) : (
              <>
                <p className="settings-blurb">{blurbOf('general')}</p>
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

/**
 * One plugin setting, drawn from what the plugin declared.
 *
 * Everything about the Plugins section is generic: a plugin that adds a field gets a working,
 * consistent control here without the dialog knowing what the field means. Adding a new *kind* of
 * field is the only thing that touches this file.
 */
function PluginField(
  { pluginId, field, value, onChange }: {
    pluginId: string
    field: PluginSettingFieldPayload
    value: string | number | boolean
    onChange: (value: string | number | boolean) => void
  },
): JSX.Element {
  const testId = `plugin-setting-${pluginId}-${field.key}`

  if (field.kind === 'boolean') {
    return (
      <label className="settings-row settings-row-indent">
        <input
          type="checkbox"
          data-testid={testId}
          checked={typeof value === 'boolean' ? value : field.default}
          onChange={(e) => { onChange(e.target.checked) }}
        />
        <span>
          <strong>{field.label}</strong>
          {field.help !== undefined && <span className="settings-help">{field.help}</span>}
        </span>
      </label>
    )
  }

  return (
    <div className="settings-row settings-row-indent settings-plugin-field">
      <label className="settings-field-label" htmlFor={testId}>{field.label}</label>
      <input
        id={testId}
        className="search"
        data-testid={testId}
        type={field.kind === 'number' ? 'number' : 'text'}
        min={field.kind === 'number' ? field.min : undefined}
        max={field.kind === 'number' ? field.max : undefined}
        placeholder={field.kind === 'string' ? field.placeholder : undefined}
        value={String(value)}
        onChange={(e) => {
          if (field.kind === 'number') {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? n : field.default)
          } else {
            onChange(e.target.value)
          }
        }}
      />
      {field.help !== undefined && <span className="settings-help">{field.help}</span>}
    </div>
  )
}
