import { createContext, useCallback, use, useEffect, useMemo, useState } from 'react'
import type { ResumeConflict, SessionNode } from '@shared/types'
import type { PlaceTarget } from '../layout'
import { useOutsideDismiss } from '../../ui/useOutsideDismiss'
import { loadSessionNote, onOpenImportDialog } from '../../state/sessions'
import { onOpenSettingsDialog } from '../../state/windowChrome'

/** Everything App can ask `DialogHost` to put on screen. */
export type DialogRequest =
  /** The session is already running elsewhere — the user picks fork, open anyway or cancel. */
  | { kind: 'conflict'; session: SessionNode; conflict: ResumeConflict }
  | { kind: 'delete'; session: SessionNode }
  /** A session dropped onto a folder row, awaiting confirmation before the transcript is moved. */
  | { kind: 'move'; session: SessionNode; toPath: string }
  /** The note as it stood when the editor opened. */
  | { kind: 'note'; session: SessionNode; note: string }
  | { kind: 'newWorktree'; path: string; label: string }
  /** A sidebar folder's "Change branch…". */
  | { kind: 'changeBranch'; path: string; label: string }
  | { kind: 'import' }
  /** The dialog cannot open without saying which section to land on. */
  | { kind: 'settings'; section: string }
  /** The layout picker opened from a context menu's "Arrange…", which has no button to hang it from. */
  | { kind: 'arrange'; target: PlaceTarget; at: { x: number; y: number } }

interface DialogState {
  conflict: { session: SessionNode; conflict: ResumeConflict } | null
  deleteTarget: SessionNode | null
  moveTarget: { session: SessionNode; toPath: string } | null
  noteTarget: { session: SessionNode; note: string } | null
  newWorktreeFor: { path: string; label: string } | null
  changeBranchFor: { path: string; label: string } | null
  importOpen: boolean
  settingsSection: string | null
  requestedPicker: { target: PlaceTarget; at: DOMRect } | null
}

export interface DialogsApi {
  state: DialogState
  /** Stable for the window's life, so handing it down never busts a memo. */
  open: (request: DialogRequest) => void
  close: (kind: DialogRequest['kind']) => void
}

/** Each kind keeps its own slot: opening one never closes another. Also owns the two native-menu requests (File > Import, Settings). */
export function useDialogs(): DialogsApi {
  const [conflict, setConflict] = useState<DialogState['conflict']>(null)
  const [deleteTarget, setDeleteTarget] = useState<DialogState['deleteTarget']>(null)
  const [moveTarget, setMoveTarget] = useState<DialogState['moveTarget']>(null)
  const [noteTarget, setNoteTarget] = useState<DialogState['noteTarget']>(null)
  const [newWorktreeFor, setNewWorktreeFor] = useState<DialogState['newWorktreeFor']>(null)
  const [changeBranchFor, setChangeBranchFor] = useState<DialogState['changeBranchFor']>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  const [requestedPicker, setRequestedPicker] = useState<DialogState['requestedPicker']>(null)

  const open = useCallback((request: DialogRequest) => {
    switch (request.kind) {
      case 'conflict': setConflict({ session: request.session, conflict: request.conflict }); break
      case 'delete': setDeleteTarget(request.session); break
      case 'move': setMoveTarget({ session: request.session, toPath: request.toPath }); break
      case 'note': setNoteTarget({ session: request.session, note: request.note }); break
      case 'newWorktree': setNewWorktreeFor({ path: request.path, label: request.label }); break
      case 'changeBranch': setChangeBranchFor({ path: request.path, label: request.label }); break
      case 'import': setImportOpen(true); break
      case 'settings': setSettingsSection(request.section); break
      case 'arrange':
        setRequestedPicker({ target: request.target, at: new DOMRect(request.at.x, request.at.y, 0, 0) })
        break
    }
  }, [])

  const close = useCallback((kind: DialogRequest['kind']) => {
    switch (kind) {
      case 'conflict': setConflict(null); break
      case 'delete': setDeleteTarget(null); break
      case 'move': setMoveTarget(null); break
      case 'note': setNoteTarget(null); break
      case 'newWorktree': setNewWorktreeFor(null); break
      case 'changeBranch': setChangeBranchFor(null); break
      case 'import': setImportOpen(false); break
      case 'settings': setSettingsSection(null); break
      case 'arrange': setRequestedPicker(null); break
    }
  }, [])

  useEffect(() => onOpenImportDialog(() => { setImportOpen(true) }), [])
  useEffect(() => onOpenSettingsDialog(() => { setSettingsSection('sessions') }), [])

  // A picker opened from a context menu has no button to anchor an outside-click handler to.
  useOutsideDismiss(() => { setRequestedPicker(null) }, {
    enabled: requestedPicker !== null,
    insideSelector: '[data-testid="layout-picker"]',
  })

  const state = useMemo<DialogState>(() => ({
    conflict, deleteTarget, moveTarget, noteTarget, newWorktreeFor, changeBranchFor, importOpen, settingsSection, requestedPicker,
  }), [conflict, deleteTarget, moveTarget, noteTarget, newWorktreeFor, changeBranchFor, importOpen, settingsSection, requestedPicker])

  return useMemo(() => ({ state, open, close }), [state, open, close])
}

/** The window's stable `open`, so a deep component can put a dialog up without props threaded down. */
export const DialogOpenContext = createContext<DialogsApi['open'] | null>(null)

export interface DialogActions {
  deleteSession: (session: SessionNode) => void
  /** A session dropped onto a folder row: confirm before its transcript is moved. */
  moveSession: (session: SessionNode, toPath: string) => void
  /** Reads the saved note first, since this window's tree can lag it. */
  editNote: (session: SessionNode) => void
  newWorktree: (path: string, label: string) => void
  changeBranch: (path: string, label: string) => void
}

/** Named, stable shortcuts over `open` for the dialogs the sidebar asks for. */
export function useDialogActions(): DialogActions {
  const open = use(DialogOpenContext)
  if (open === null) throw new Error('useDialogActions outside a DialogOpenContext provider')
  return useMemo(() => ({
    deleteSession: (session) => { open({ kind: 'delete', session }) },
    moveSession: (session, toPath) => { open({ kind: 'move', session, toPath }) },
    editNote: (session) => {
      // The row's note stands in if main cannot say.
      void loadSessionNote(session.sessionId).then((note) => { open({ kind: 'note', session, note: note ?? session.note ?? '' }) })
    },
    newWorktree: (path, label) => { open({ kind: 'newWorktree', path, label }) },
    changeBranch: (path, label) => { open({ kind: 'changeBranch', path, label }) },
  }), [open])
}
