import { type JSX, useCallback } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { NewSessionInfo, SessionNode } from '@shared/types'
import type { UpdateStatusPayload } from '@shared/api'
import { ConflictDialog } from './ConflictDialog'
import { DialogBoundary } from './DialogBoundary'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { MoveSessionDialog } from './MoveSessionDialog'
import { ImportDialog } from './ImportDialog'
import { NoteDialog } from './NoteDialog'
import { NewWorktreeDialog } from '../git/NewWorktreeDialog'
import { FolderBranchDialog } from '../git/FolderBranchDialog'
import { SettingsDialog } from '../settings/SettingsDialog'
import { LayoutPicker } from '../layout/LayoutPicker'
import type { PlaceTarget } from '../layout/layoutContext'
import type { PresetId } from '../layout/layout'
import type { DialogsApi } from './useDialogs'
import { moveSession, saveSessionNote } from '../../state/sessions'
import { surface } from '../../state/policy'

/**
 * Renders whichever dialogs `useDialogs` has open (UI-1 step 5). The dialogs that are only IPC
 * (move, note) are finished here; the ones whose outcome changes workspace or `ui` state hand
 * back to App through the `on…` props, after closing themselves — the order each inline handler
 * used before.
 */
export function DialogHost({
  dialogs, currentPreset, isTabOpen, onPlace,
  onFork, onOpenAnyway, onConfirmDelete, onWorktreeCreated, onSessionStarted,
  importWidth, onImportWidthChange, onImported,
  settingsUpdate, onSettingsClosed,
}: {
  dialogs: DialogsApi
  currentPreset: PresetId
  /** Whether a tab is still open in this window — the arrange picker's target may have closed. */
  isTabOpen: (key: string) => boolean
  onPlace: (target: PlaceTarget, preset: PresetId, zone: number) => void
  /** Forking goes through the fork path, not through resume-with-a-flag. */
  onFork: (sessionId: SessionId) => void
  onOpenAnyway: (session: SessionNode) => void
  onConfirmDelete: (session: SessionNode) => void
  /** `folder` is the folder the worktree was made from. */
  onWorktreeCreated: (info: NewSessionInfo, folder: string) => void
  /** A session started from a folder's "Change branch…" (its conflict dialog's "New session there"). */
  onSessionStarted: (info: NewSessionInfo) => void
  importWidth: number
  onImportWidthChange: (width: number) => void
  onImported: () => void
  settingsUpdate: UpdateStatusPayload | null
  onSettingsClosed: () => void
}): JSX.Element {
  const { state, close } = dialogs
  const closeChangeBranch = useCallback(() => { close('changeBranch') }, [close])
  const { requestedPicker, conflict, newWorktreeFor, changeBranchFor, deleteTarget, moveTarget, importOpen, settingsSection, noteTarget } = state
  return (
    <>
      {requestedPicker !== null && (
        <ArrangePicker
          request={requestedPicker}
          currentPreset={currentPreset}
          isTabOpen={isTabOpen}
          onPlace={onPlace}
          onClose={() => { close('arrange') }}
        />
      )}

      {conflict !== null && (
        <ConflictDialog
          conflict={conflict.conflict}
          onCancel={() => { close('conflict') }}
          onFork={() => {
            close('conflict')
            // Forking goes through the fork path, not through resume-with-a-flag. The old code
            // marked the *original* session resumed and pointed its tab at a pty that was in fact
            // running a different, newly-minted session — so the original's transcript never
            // moved and the fork turned up later as a row with no terminal behind it.
            onFork(conflict.session.sessionId)
          }}
          onOpenAnyway={() => { close('conflict'); onOpenAnyway(conflict.session) }}
        />
      )}

      {newWorktreeFor !== null && (
        <DialogBoundary onClose={() => { close('newWorktree') }}>
          <NewWorktreeDialog
            folderPath={newWorktreeFor.path}
            folderLabel={newWorktreeFor.label}
            onClose={() => { close('newWorktree') }}
            onCreated={(info) => { close('newWorktree'); onWorktreeCreated(info, newWorktreeFor.path) }}
          />
        </DialogBoundary>
      )}
      {changeBranchFor !== null && (
        <DialogBoundary onClose={closeChangeBranch}>
          <FolderBranchDialog
            // A fresh picker for each folder, never one carrying the last folder's query or step.
            key={changeBranchFor.path}
            path={changeBranchFor.path}
            label={changeBranchFor.label}
            onClose={closeChangeBranch}
            onSessionStarted={onSessionStarted}
          />
        </DialogBoundary>
      )}
      {deleteTarget !== null && (
        <DeleteSessionDialog
          title={deleteTarget.title}
          onCancel={() => { close('delete') }}
          onConfirm={() => { close('delete'); onConfirmDelete(deleteTarget) }}
        />
      )}

      {moveTarget !== null && (
        <MoveSessionDialog
          sessionTitle={moveTarget.session.title}
          fromPath={moveTarget.session.cwd}
          toPath={moveTarget.toPath}
          onCancel={() => { close('move') }}
          onConfirm={() => {
            const { session, toPath } = moveTarget
            close('move')
            surface(moveSession(session.sessionId, toPath), 'Could not move session')
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => { close('import') }}
          onImported={onImported}
          width={importWidth}
          onWidthChange={onImportWidthChange}
        />
      )}

      {settingsSection !== null && (
        <SettingsDialog
          initialSection={settingsSection}
          onClose={() => { close('settings'); onSettingsClosed() }}
          update={settingsUpdate}
        />
      )}

      {noteTarget !== null && (
        <NoteDialog
          sessionTitle={noteTarget.session.title}
          initial={noteTarget.note}
          onClose={() => { close('note') }}
          onSave={(note) => {
            const id = noteTarget.session.sessionId
            close('note')
            saveSessionNote(id, note)
          }}
        />
      )}
    </>
  )
}

/** The layout picker opened from a context menu's "Arrange…", inside its own boundary (B11). */
function ArrangePicker({ request, currentPreset, isTabOpen, onPlace, onClose }: {
  request: { target: PlaceTarget; at: DOMRect }
  currentPreset: PresetId
  /** Whether a tab is still open in this window — the picker's target may have closed. */
  isTabOpen: (key: string) => boolean
  onPlace: (target: PlaceTarget, preset: PresetId, zone: number) => void
  onClose: () => void
}): JSX.Element {
  return (
    <DialogBoundary onClose={onClose}>
      <LayoutPicker
        anchor={request.at}
        mode="place"
        heading="Arrange"
        current={currentPreset}
        // Opened from a context-menu command, never from the pointer merely resting somewhere —
        // always takes focus (UI-28).
        focusOnOpen
        onPick={(preset, zone) => {
          onClose()
          // The target was captured when the picker opened; by the time a zone is picked the
          // tab it named may have closed. Placing it then would reopen a session nobody asked
          // for, so a tab target that is no longer open in the window is silently dropped.
          if (request.target.kind === 'tab' && !isTabOpen(request.target.key)) return
          onPlace(request.target, preset, zone)
        }}
        onClose={onClose}
      />
    </DialogBoundary>
  )
}
