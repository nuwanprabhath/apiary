import { type JSX, useCallback } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { NewSessionInfo, SessionNode } from '@shared/types'
import type { UpdateStatusPayload } from '@shared/api'
import { AccountSwitchHost } from '../chat'
import { ConflictDialog } from './ConflictDialog'
import { DialogBoundary } from './DialogBoundary'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { MoveSessionDialog } from './MoveSessionDialog'
import { ImportDialog } from './ImportDialog'
import { NoteDialog } from './NoteDialog'
import { NewWorktreeDialog, FolderBranchDialog } from '../git'
import { SettingsDialog } from '../settings'
import { LayoutPicker } from '../layout'
import type { PlaceTarget } from '../layout'
import type { PresetId } from '../../state/layout'
import type { DialogsApi } from './useDialogs'
import { moveSession, saveSessionNote } from '../../state/sessions'
import { surface } from '../../state/policy'

/**
 * Renders whichever dialogs `useDialogs` has open. Move and note finish here; the ones that change
 * workspace or `ui` state close themselves, then hand back to App through the `on…` props.
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
      <AccountSwitchHost />
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
            // Not resume-with-a-flag: that would mark the original session resumed and point its tab
            // at a pty running the newly minted fork.
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
            // A fresh picker per folder, not one carrying the last folder's query or step.
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
          onSessionStarted={onSessionStarted}
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

function ArrangePicker({ request, currentPreset, isTabOpen, onPlace, onClose }: {
  request: { target: PlaceTarget; at: DOMRect }
  currentPreset: PresetId
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
        focusOnOpen
        onPick={(preset, zone) => {
          onClose()
          // The tab named when the picker opened may have closed; placing it would reopen a
          // session nobody asked for.
          if (request.target.kind === 'tab' && !isTabOpen(request.target.key)) return
          onPlace(request.target, preset, zone)
        }}
        onClose={onClose}
      />
    </DialogBoundary>
  )
}
