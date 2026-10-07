import { createContext, useCallback, use, useEffect, useMemo, useState } from 'react'
import type { ResumeConflict, SessionNode } from '@shared/types'
import type { PlaceTarget } from '../layout/layoutContext'

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
  /** Which settings section to land on — one value, so the dialog cannot open without saying what
   *  it should show ("Update settings" in the update banner is the reason). */
  | { kind: 'settings'; section: string }
  /** The layout picker opened from a context menu's "Arrange…", which has no button to hang it from. */
  | { kind: 'arrange'; target: PlaceTarget; at: { x: number; y: number } }

export interface DialogState {
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

/**
 * The state behind every dialog App can show (UI-1 step 5). Each kind keeps its own slot, as the
 * separate `useState`s did: opening one never closes another, so behaviour is unchanged. Rendering
 * lives in `DialogHost`; this also owns the two native-menu requests (File > Import, Settings).
 */
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

  useEffect(() => window.apiary.onOpenImportDialog(() => { setImportOpen(true) }), [])
  useEffect(() => window.apiary.onOpenSettingsDialog(() => { setSettingsSection('sessions') }), [])

  // A requested picker (opened from a context menu, with no button of its own to anchor a
  // blur/mousedown handler to) has to close itself on an outside click.
  useEffect(() => {
    if (requestedPicker === null) return
    const closeOnOutside = (e: MouseEvent): void => {
      const inPicker = (e.target as Element | null)?.closest('[data-testid="layout-picker"]')
      if (inPicker === null || inPicker === undefined) setRequestedPicker(null)
    }
    window.addEventListener('mousedown', closeOnOutside)
    return () => { window.removeEventListener('mousedown', closeOnOutside) }
  }, [requestedPicker])

  const state = useMemo<DialogState>(() => ({
    conflict, deleteTarget, moveTarget, noteTarget, newWorktreeFor, changeBranchFor, importOpen, settingsSection, requestedPicker,
  }), [conflict, deleteTarget, moveTarget, noteTarget, newWorktreeFor, changeBranchFor, importOpen, settingsSection, requestedPicker])

  return useMemo(() => ({ state, open, close }), [state, open, close])
}

/** The window's stable `open`, so a component deep in the tree can put a dialog up without App
 *  threading `onDeleteSession`/`onEditNote`-style props down to it (UI-1 step 5). */
export const DialogOpenContext = createContext<DialogsApi['open'] | null>(null)

export interface DialogActions {
  deleteSession: (session: SessionNode) => void
  /** A session dropped onto a folder row: confirm before its transcript is moved. */
  moveSession: (session: SessionNode, toPath: string) => void
  /** Reads the saved note first, so the editor opens on what is actually stored even if this
   *  window's tree is a moment out of date. */
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
      void window.apiary.sessionNote(session.sessionId)
        .then((note) => { open({ kind: 'note', session, note }) })
        .catch(() => { open({ kind: 'note', session, note: session.note ?? '' }) })
    },
    newWorktree: (path, label) => { open({ kind: 'newWorktree', path, label }) },
    changeBranch: (path, label) => { open({ kind: 'changeBranch', path, label }) },
  }), [open])
}
