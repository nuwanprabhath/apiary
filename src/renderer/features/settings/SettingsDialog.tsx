import { type JSX, useEffect, useState } from 'react'
import type { AppSettingsPayload, PluginInfoPayload, UpdateStatusPayload } from '@shared/api'
import { SECTIONS, blurbOf } from './registry'
import { useNotifications } from '../../ui/notifications'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'

/**
 * One page of settings. Sections are data, not markup — adding a setting later means adding an
 * entry to `registry.ts` (a component and a field in `AppSettingsPayload`), not restructuring
 * this file (UI-20). The nav down the left is generated from the same list, so the two can never
 * disagree about what exists.
 */
export function SettingsDialog(
  { onClose, initialSection, update }: {
    onClose: () => void
    initialSection?: string
    /** App's one shared `useUpdate()` subscription — read here, never re-subscribed to (UI-20):
     *  the banner and this dialog must never disagree about whether a download is running. */
    update: UpdateStatusPayload | null
  },
): JSX.Element {
  const { notifyError } = useNotifications()
  // Whoever opens the dialog says which section it should land on; an unknown id falls back to
  // the first rather than showing an empty pane.
  const known = SECTIONS.some((s) => s.id === initialSection)
  const [section, setSection] = useState<string>(known && initialSection !== undefined
    ? initialSection
    : SECTIONS[0].id)
  // Null until the first load resolves; every field below is driven from this one object, so a
  // new setting is a new key rather than another piece of local state to remember to save.
  const [draft, setDraft] = useState<AppSettingsPayload | null>(null)
  const [saving, setSaving] = useState(false)
  /** How many sessions/notes are indexed, and whether a rebuild is running — the Search section's
   *  state, owned here rather than in the section itself so it is loaded once for the dialog's
   *  whole life, not refetched every time Search is revisited (see SearchSection.tsx). */
  const [indexed, setIndexed] = useState<number | null>(null)
  const [notesIndexed, setNotesIndexed] = useState<number>(0)
  const [rebuilding, setRebuilding] = useState(false)
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
    // User-initiated (UI-23): a failure here leaves `draft` null forever, which the pane below
    // renders as "Loading settings…" — silently, and indefinitely, with no way to tell that from
    // an actually slow load. A toast at least says it isn't coming.
    void window.apiary.settingsGet().then(setDraft).catch((e: unknown) => {
      notifyError(e, 'Could not load settings')
    })
  }, [notifyError])

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

  const onRebuild = (): void => {
    setRebuilding(true)
    void window.apiary.searchRebuild()
      .catch(() => {
        // Nothing to recover: the old index is still in place either way.
      })
      .finally(() => { setRebuilding(false); loadIndexStatus() })
  }

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return (
    // UI-24: confines a render fault to this dialog instead of the whole window.
    <ErrorBoundary label="This dialog">
      {/* UI-25: onto the shared Modal primitive (Escape already worked via UI-13; this adds a
       *  labelled role, a Tab trap and focus restore on close). */}
      <Modal testId="settings-dialog" titleId="settings-dialog-title" onClose={onClose} className="settings-dialog">
        <h2 id="settings-dialog-title">Settings</h2>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className="settings-nav-item"
                data-testid={`settings-nav-${s.id}`}
                data-active={section === s.id}
                onClick={() => { setSection(s.id) }}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="settings-pane" data-testid="settings-pane">
            {draft === null ? (
              <p className="empty">Loading settings…</p>
            ) : (
              <>
                <p className="settings-blurb">{blurbOf(active.id)}</p>
                <active.Component
                  draft={draft} patch={patch} update={update} plugins={plugins}
                  indexed={indexed} notesIndexed={notesIndexed} rebuilding={rebuilding}
                  onRebuild={onRebuild}
                />
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
      </Modal>
    </ErrorBoundary>
  )
}
