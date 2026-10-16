import { type JSX, useEffect, useRef, useState } from 'react'
import type { PluginInfoPayload, UpdateStatusPayload } from '@shared/api'
import type { NewSessionInfo } from '@shared/types'
import { SECTIONS, blurbOf } from './registry'
import { useNotifications } from '../../ui/notifications'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
import { treeStore } from '../../state/treeStore'
import { listPlugins } from '../../state/plugins'
import { rebuildSearchIndex, readSearchStatus } from '../../state/sessions'
import { readSettings, saveSettingsDraft, type SettingsDraft } from '../../state/settingsStore'
import { setSpellingLanguage } from '../../state/spelling'

/** Sections are data: a new one is an entry in `registry.ts`, which also generates the nav. */
export function SettingsDialog(
  { onClose, initialSection, update, onSessionStarted }: {
    onClose: () => void
    initialSection?: string
    /** App's one shared `useUpdate()` subscription, so the banner and this dialog agree. */
    update: UpdateStatusPayload | null
    /** Opens a session this dialog started (an account's login) as a tab. */
    onSessionStarted: (info: NewSessionInfo) => void
  },
): JSX.Element {
  const { notifyError } = useNotifications()
  // An unknown id falls back to the first section.
  const known = SECTIONS.some((s) => s.id === initialSection)
  const [section, setSection] = useState<string>(known && initialSection !== undefined
    ? initialSection
    : SECTIONS[0].id)
  // Null until the first load resolves; a new setting is a new key on this one object.
  const [draft, setDraft] = useState<SettingsDraft | null>(null)
  const [saving, setSaving] = useState(false)
  // The proofing language as it was loaded, so Save applies the dictionary only when it changed.
  const loadedProofing = useRef<string | null>(null)
  // The Search section's state lives here so it loads once per dialog, not per visit to Search.
  const [indexed, setIndexed] = useState<number | null>(null)
  const [notesIndexed, setNotesIndexed] = useState<number>(0)
  const [rebuilding, setRebuilding] = useState(false)
  const [plugins, setPlugins] = useState<PluginInfoPayload[]>([])
  useEffect(() => {
    void listPlugins().then(setPlugins)
  }, [])

  const loadIndexStatus = (): void => {
    void readSearchStatus().then((s) => {
      if (s === null) { setIndexed(null); return }
      setIndexed(s.indexed)
      setNotesIndexed(s.notes)
    })
  }
  useEffect(loadIndexStatus, [])
  // Indexing runs in the background and main announces a finished pass like a rescan, so re-read.
  useEffect(() => treeStore.onChanged(loadIndexStatus), [])

  useEffect(() => {
    // A failure leaves `draft` null, indistinguishable from a slow load; the toast says it isn't coming.
    void readSettings().then((settings) => {
      loadedProofing.current = settings.proofingLanguage
      setDraft(settings)
    }).catch((e: unknown) => {
      notifyError(e, 'Could not load settings')
    })
  }, [notifyError])

  const patch = (fields: Partial<SettingsDraft>): void => {
    setDraft((prev) => (prev === null ? prev : { ...prev, ...fields }))
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    try {
      await saveSettingsDraft({
        ...draft,
        claudeBin: draft.claudeBin?.trim() === '' ? null : draft.claudeBin,
      })
      if (draft.proofingLanguage !== loadedProofing.current) await setSpellingLanguage(draft.proofingLanguage)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const onRebuild = (): void => {
    setRebuilding(true)
    // The old index is still in place when this fails, so the status below stays true.
    void rebuildSearchIndex().then(() => { setRebuilding(false); loadIndexStatus() })
  }

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return (
    <ErrorBoundary label="This dialog">
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
                  // Closed so the login tab is what the person sees; accounts apply at once, not on Save.
                  onLoginStarted={(info) => { onSessionStarted(info); onClose() }}
                />
              </>
            )}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn" data-testid="settings-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
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
