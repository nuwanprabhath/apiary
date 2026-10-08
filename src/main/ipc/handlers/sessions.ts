import { clipboard, type WebContents } from 'electron'
import { IPC } from '@shared/api'
import { UNTITLED_SESSION } from '@shared/types'
import type { AppService } from '../../appService'
import { renameInClaude, type RenameDeps } from '../../claude/claudeRename'
import { fireAndForget } from '../../log/fireAndForget'
import { log } from '../../log/logger'
import { broadcast } from '../../windows/broadcast'
import type { Handlers } from '../registrar'

export interface SessionsDeps {
  service: AppService
  /** Shared with `handlers/terminals.ts`'s `renameTerminalInClaude`, so both go through the same
   *  Claude session tracker rather than each keeping their own. */
  renameDeps: () => RenameDeps
  pickFolder?: (sender: WebContents) => Promise<string | null>
}

type HandledKeys =
  | 'refresh' | 'tree' | 'searchContent' | 'discovered' | 'importSessions' | 'transcript' | 'checkConflict'
  | 'resume' | 'renameSession' | 'removeSession' | 'moveSession' | 'setSessionNote' | 'sessionNote'
  | 'searchRebuild' | 'searchStatus' | 'saveImage' | 'readImage' | 'newSessionInProject' | 'forkSession'
  | 'copyToClipboard' | 'newSessionInPickedFolder'

/** The project tree, sessions and search — everything that is not a terminal, a git action or a
 *  tab move. */
export function sessionsHandlers(deps: SessionsDeps): Pick<Handlers, HandledKeys> {
  const { service, renameDeps } = deps

  return {
    refresh: async () => {
      // Refresh also means "check merge requests again": the likeliest reason to press it is
      // having just merged one. Every view re-asks when told the cache is gone.
      service.invalidateMrStatuses()
      broadcast(IPC.mrStatusesInvalidated)
      log.info('mr-status', 'invalidated by refresh')
      return service.refresh()
    },
    tree: () => service.tree(),
    // The path comes from the OS dialog, never from the renderer — which is what makes
    // `newSessionInFolder` (any folder, even one new to Apiary) safe to call with it.
    newSessionInPickedFolder: async (e) => {
      const folder = deps.pickFolder === undefined ? null : await deps.pickFolder(e.sender)
      return folder === null ? null : service.newSessionInFolder(folder)
    },
    searchContent: (_e, query) => service.searchSessions(query),
    discovered: async () =>
      (await service.discovered()).map((s) => ({
        sessionId: s.sessionId,
        projectPath: s.projectPath,
        title: s.title ?? s.firstPrompt ?? UNTITLED_SESSION,
        lastActiveAtMs: s.lastActiveAtMs,
        imported: s.imported,
      })),
    importSessions: (_e, ids, projects) => service.importSessions(ids, projects),
    transcript: (_e, id, beforeIndex) => service.transcript(id, beforeIndex),
    checkConflict: (_e, id) => service.checkConflict(id),
    resume: (_e, id) => service.resume(id),
    renameSession: async (_e, id, title) => {
      await service.renameSession(id, title)
      // And in Claude's own record, where the VS Code extension and /resume read the name — only
      // for a session running here, and only once it is safe to type into (see claudeRename.ts).
      // Not awaited: it can wait up to a minute for Claude to go idle, and the rename in Apiary is
      // done.
      if (title.trim() !== '') {
        fireAndForget(renameInClaude(renameDeps(), id, title), 'rename') // the Apiary rename already succeeded; a failure here is only logged
      }
      // Nothing on disk changed, so the filesystem watcher will never fire for this — push the
      // same "tree changed" signal it uses so every open view (the sidebar list here, and any
      // other window) picks up the new title immediately instead of only on its next unrelated
      // refresh.
      broadcast(IPC.treeChanged)
    },
    removeSession: async (_e, id) => {
      await service.removeSession(id)
      broadcast(IPC.treeChanged)
    },
    moveSession: async (_e, id, targetPath) => {
      await service.moveSession(id, targetPath)
      // Same signal a rename or an archive sends: the sidebar re-reads the (unfiltered, cached)
      // tree, which now shows the session under its new project instead of the old one.
      await service.refresh()
      broadcast(IPC.treeChanged)
    },
    setSessionNote: async (_e, id, note) => {
      await service.setSessionNote(id, note)
      // The note shows in the sidebar's hover card and changes what searches match, so every
      // window needs to re-read the tree — the same signal a rename sends.
      broadcast(IPC.treeChanged)
    },
    sessionNote: (_e, id) => service.sessionNote(id),
    searchRebuild: async () => { await service.rebuildSearchIndex() },
    searchStatus: () => ({
      indexed: service.searchIndexCount(),
      notes: service.searchNoteCount(),
    }),
    saveImage: (_e, base64, mediaType) => service.saveImage(base64, mediaType),
    readImage: (_e, path) => service.readImage(path),
    newSessionInProject: (_e, path) => service.newSessionInProject(path),
    forkSession: (_e, id) => service.forkSession(id),
    // Electron 44 made `clipboard.writeText` async (it now follows the W3C `navigator.clipboard`
    // shape); returning it here lets the registrar await and log a rejection instead of the
    // promise going unhandled.
    copyToClipboard: (_e, text) => clipboard.writeText(text),
  }
}
