/**
 * Sessions, terminals and the small services around them in the fake, modelled on main's handlers:
 * the tree and what changes it (and the `treeChanged` that follows), notes, transcripts, starting
 * and forking sessions (a pending terminal, never in a folder the app does not know), the images
 * pasted into the composer, VS Code and the diagnostic log. A running pty is not modelled: nothing
 * is ever running here, so what is sent to a terminal is ignored, as main ignores it for one that is
 * gone. The contract (`tests/contract/clauses/{sessions,terminals,misc}.ts`) pins it.
 */
import type { ApiaryApi, DiscoveredSession } from '@shared/api'
import type { NewSessionInfo, ProjectNode, SessionNode, TranscriptMessage, TranscriptPage } from '@shared/types'
import { TRANSCRIPT_PAGE_SIZE } from '@shared/types'
import { forkLabel } from '@shared/forkLabel'
import { asSessionId } from '@shared/domain/ids'
import type { Env, FakeSession } from './state'

type SessionsApi = Pick<ApiaryApi,
  | 'refresh' | 'tree' | 'discovered' | 'importSessions' | 'transcript' | 'checkConflict' | 'resume' | 'renameSession'
  | 'renameTerminalInClaude' | 'removeSession' | 'moveSession' | 'newSessionInProject' | 'newSessionInPickedFolder'
  | 'forkSession' | 'setSessionNote' | 'sessionNote' | 'openShell' | 'openShellForPty' | 'ptyWrite' | 'ptyResize'
  | 'ptyKill' | 'ptyResume' | 'ptyAttach' | 'ptyDetach' | 'ptySnapshot' | 'ptySessions' | 'ptyRunning' | 'sendPrompt'
  | 'saveImage' | 'readImage' | 'vsCodeAvailable' | 'openInVsCode' | 'openMentionedFile' | 'copyToClipboard'
  | 'logStatus' | 'logReveal' | 'logClear' | 'logWrite' | 'appMenu' | 'appMenuInvoke' | 'setTitleBarColors'>

const DAY = 24 * 60 * 60 * 1000
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function message(
  uuid: string, role: 'user' | 'assistant', text: string, extra: Partial<TranscriptMessage> = {},
): TranscriptMessage {
  return { uuid, role, timestampMs: Date.parse('2026-09-01T10:00:00Z'), isSidechain: false, blocks: [{ type: 'text', text }], ...extra }
}

export function sessionsApi(env: Env): SessionsApi {
  const { state, emit, find } = env
  const hasSessions = (n: ProjectNode): boolean => n.sessions.length > 0 || n.children.some(hasSessions)
  const sessionNode = (s: FakeSession): SessionNode => ({
    kind: 'session',
    sessionId: asSessionId(s.sessionId),
    title: s.title,
    cwd: s.projectPath,
    gitBranch: s.gitBranch ?? null,
    lastActiveAtMs: s.lastActiveAtMs ?? Date.now() - 22 * DAY,
    messageCount: (s.messages ?? []).length || 2,
    isLive: s.isLive ?? false,
    cwdExists: s.cwdExists ?? true,
    note: s.note ?? null,
  })
  const tree = (): ProjectNode[] => {
    const shown = state.sessions.filter((s) => state.imported.has(s.sessionId) && !state.archived.has(s.sessionId))
    const node = (p: (typeof state.projects)[number]): ProjectNode => ({
      kind: 'project',
      path: p.path,
      label: p.label,
      branch: p.branch,
      isWorktree: p.isWorktree ?? false,
      children: state.projects.filter((c) => c.parent === p.path).map(node).filter(hasSessions),
      sessions: shown.filter((s) => s.projectPath === p.path).map(sessionNode),
    })
    return state.projects.filter((p) => p.parent === undefined).map(node).filter(hasSessions)
  }
  const transcript = (id: string, beforeIndex?: number): TranscriptPage => {
    const all = find(id)?.messages ?? [message(`${id}-u`, 'user', 'fix the export'), message(`${id}-a`, 'assistant', 'done')]
    const end = beforeIndex ?? all.length
    // The same page size as transcriptReader.ts (TEST-5; the contract suite pins the two together).
    const start = Math.max(0, end - TRANSCRIPT_PAGE_SIZE)
    return { messages: all.slice(start, end), earlierCursor: start > 0 ? start : null, skippedLines: 0 }
  }
  const requireSession = (id: string): FakeSession => {
    const s = find(id)
    if (s === undefined) throw new Error('Unknown session.')
    return s
  }
  const knownFolder = (path: string): void => {
    if (!state.projects.some((p) => p.path === path)) throw new Error('This folder is not known.')
  }
  let images = 0

  return {
    // Real main sends mrStatusesInvalidated on refresh, not treeChanged (ipc.ts) — the caller
    // re-fetches the tree from the invoke's own return value (Sidebar.tsx's reloadNow), not from
    // an event.
    refresh: async () => { emit('mrStatusesInvalidated') },
    tree: async () => tree(),
    discovered: async (): Promise<DiscoveredSession[]> => state.sessions.map((s) => ({
      sessionId: asSessionId(s.sessionId), projectPath: s.projectPath, title: s.title,
      lastActiveAtMs: s.lastActiveAtMs ?? Date.now() - 22 * DAY, imported: state.imported.has(s.sessionId),
    })),
    importSessions: async (ids) => { for (const id of ids) state.imported.add(id) },
    transcript: async (id, before) => transcript(id, before),
    // Someone else's process is running the session: the conflict names it.
    checkConflict: async (id) => (find(id)?.isLive === true ? { sessionId: id, pid: 4242 } : null),
    // As in main, a change to what the tree shows is followed by a tree-changed event.
    renameSession: async (id, title) => { const s = find(id); if (s !== undefined) s.title = title; emit('treeChanged') },
    // As in main (AppService.removeSession): archived, not un-imported, so the import dialog does
    // not offer it again as new.
    removeSession: async (id) => { state.archived.add(id); emit('treeChanged') },
    moveSession: async (id, target) => { const s = find(id); if (s !== undefined) s.projectPath = target; emit('treeChanged') },
    // AppService.setSessionNote trims (appService.ts:567) before deciding empty-vs-not.
    setSessionNote: async (id, note) => {
      const trimmed = note.trim()
      const s = find(id)
      if (s !== undefined) s.note = trimmed === '' ? null : trimmed
      emit('treeChanged')
    },
    sessionNote: async (id) => find(id)?.note ?? '',

    newSessionInProject: async (path) => { knownFolder(path); return env.newSession(path) },
    // Main answers with the folder the native picker returned (or none, when it was dismissed).
    newSessionInPickedFolder: async (): Promise<NewSessionInfo | null> =>
      (state.pickedFolder === null ? null : env.newSession(state.pickedFolder)),
    forkSession: async (id) => {
      const s = requireSession(id)
      if (s.cwdExists === false) throw new Error(`The folder for this session no longer exists: ${s.projectPath}`)
      return { ...env.newSession(s.projectPath), label: forkLabel(s.title) }
    },

    // Terminals: nothing is ever running here, so a session or terminal is only "known" to main when
    // the app has it, and what is sent to one that is not running is ignored.
    resume: async (id) => { requireSession(id) },
    openShell: async (id) => { requireSession(id) },
    openShellForPty: async (id) => { if (!env.pendingPtys.has(id)) throw new Error('This terminal is not known.') },
    renameTerminalInClaude: () => {},
    ptyWrite: () => {},
    ptyResize: () => {},
    ptyKill: () => {},
    ptyResume: () => {},
    ptyAttach: () => {},
    ptyDetach: () => {},
    ptySnapshot: async () => null,
    ptySessions: async () => ({}),
    ptyRunning: async () => [],
    sendPrompt: async () => {},

    saveImage: async (base64, mediaType) => {
      if (!IMAGE_TYPES.includes(mediaType)) throw new Error(`Unsupported image type: ${mediaType}`)
      if (base64 === '') throw new Error('That image was empty.')
      images += 1
      const path = `/fixture/images/pasted-${String(images)}.${mediaType.split('/')[1]}`
      state.images.set(path, `data:${mediaType};base64,${base64}`)
      return path
    },
    // Only an image the app saved can be read back.
    readImage: async (path) => {
      const dataUrl = state.images.get(path)
      return dataUrl === undefined ? null : { dataUrl }
    },
    vsCodeAvailable: async () => state.vsCode,
    openInVsCode: async () => { if (!state.vsCode) throw new Error('VS Code was not found on this machine.') },
    openMentionedFile: async () => { if (!state.vsCode) throw new Error('VS Code was not found on this machine.') },
    copyToClipboard: async (text) => { state.copied.push(text) },

    logStatus: async () => state.log,
    logReveal: async () => state.log.dir,
    logClear: async () => { state.log = { ...state.log, files: 0, bytes: 0 }; return state.log },
    logWrite: () => {},

    // A small stand-in for main's application menu, in the shape serializeMenu produces.
    appMenu: async () => [
      { label: 'File', kind: 'submenu', enabled: true, submenu: [
        { label: 'New Window', kind: 'normal', enabled: true, accelerator: 'Ctrl+N' },
        { label: '', kind: 'separator', enabled: true },
        { label: 'Settings...', kind: 'normal', enabled: true, accelerator: 'Ctrl+,' },
      ] },
      { label: 'View', kind: 'submenu', enabled: true, submenu: [
        { label: 'Toggle Sidebar', kind: 'normal', enabled: true, accelerator: 'Ctrl+Shift+B' },
        { label: 'Appearance', kind: 'submenu', enabled: true, submenu: [
          { label: 'Full Screen', kind: 'checkbox', enabled: true, checked: false, accelerator: 'F11' },
        ] },
      ] },
    ],
    appMenuInvoke: async () => {},
    setTitleBarColors: () => {},
  }
}
