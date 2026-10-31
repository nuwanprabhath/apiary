import { type JSX, useEffect, useRef, useState } from 'react'
import type { PluginInfoPayload, UpdateStatusPayload } from '@shared/api'
import type { NewSessionInfo } from '@shared/types'
import { SECTIONS, blurbOf } from './registry'
import { MachineSwitch, ScreenSettingsNote } from './MachineSwitch'
import { useNotifications } from '../../ui/notifications'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
import { useSearchIndexStatus } from './useSearchIndexStatus'
import {
  listSettingsPlugins, readSettings, saveSettingsDraft, setSettingsTarget, thisComputerName, useSettingsTarget,
  type SettingsDraft,
} from '../../state/settingsStore'
import { setSpellingLanguage } from '../../state/spelling'
import { remoteHost } from '../../state/windowParams'

/**
 * Sections are data: a new one is an entry in `registry.ts`, which also generates the nav.
 *
 * In a remote window the dialog edits the work machine's settings first, and a switch at the top
 * changes it to this machine's (`SettingsTarget`). The work machine's view leaves out the sections
 * about how this screen looks.
 */
export function SettingsDialog(
  { onClose: close, initialSection, update, onSessionStarted }: {
    onClose: () => void
    initialSection?: string
    /** App's one shared `useUpdate()` subscription, so the banner and this dialog agree. */
    update: UpdateStatusPayload | null
    /** Opens a session this dialog started (an account's login) as a tab. */
    onSessionStarted: (info: NewSessionInfo) => void
  },
): JSX.Element {
  const { notifyError } = useNotifications()
  const host = remoteHost()
  const target = useSettingsTarget()
  const machineHost = host !== null && target === 'machine' ? host : null
  const sections = host === null ? SECTIONS : SECTIONS.filter((s) => (machineHost === null ? s.machineOnly !== true : s.screen !== true))
  // The next opening starts on the machine the window shows again.
  const onClose = (): void => { setSettingsTarget('machine'); close() }
  useEffect(() => () => { setSettingsTarget('machine') }, [])
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
  const { indexed, notesIndexed, rebuilding, onRebuild } = useSearchIndexStatus()
  const [plugins, setPlugins] = useState<PluginInfoPayload[]>([])
  useEffect(() => {
    void listSettingsPlugins().then(setPlugins)
  }, [target])

  useEffect(() => {
    // Switching machines reads the other one's settings; what was typed and not saved goes with it.
    setDraft(null)
    // A failure leaves `draft` null, indistinguishable from a slow load; the toast says it isn't coming.
    void readSettings().then((settings) => {
      loadedProofing.current = settings.proofingLanguage
      setDraft(settings)
    }).catch((e: unknown) => {
      notifyError(e, 'Could not load settings')
    })
  }, [notifyError, target])

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
      if (machineHost === null && draft.proofingLanguage !== loadedProofing.current) await setSpellingLanguage(draft.proofingLanguage)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const active = sections.find((s) => s.id === section) ?? sections[0]
  const title = host === null ? 'Settings' : `Settings — ${machineHost ?? thisComputerName()}`

  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="settings-dialog" titleId="settings-dialog-title" onClose={onClose} className="settings-dialog">
        <h2 id="settings-dialog-title">{title}</h2>
        {host !== null && <MachineSwitch host={host} target={target} onChange={setSettingsTarget} />}

        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings sections">
            {sections.map((s) => (
              <button
                key={s.id}
                className="settings-nav-item"
                data-testid={`settings-nav-${s.id}`}
                data-active={active.id === s.id}
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
                  onRebuild={onRebuild} machineHost={machineHost}
                  // Closed so the login tab is what the person sees; accounts apply at once, not on Save.
                  onLoginStarted={(info) => { onSessionStarted(info); onClose() }}
                />
              </>
            )}
            {machineHost !== null && <ScreenSettingsNote onSwitch={() => { setSettingsTarget('this') }} />}
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
