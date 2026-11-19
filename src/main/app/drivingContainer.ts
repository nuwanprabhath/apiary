import { basename } from 'node:path'
import type { VirtualContentsRegistry } from '../remote/virtualContents'
import { frontWindow, sendOpenSession } from './residentsContainer'
import type { ChatService } from '../chat/chatService'
import { SessionDriver, type FolderSource } from '../driving/sessionDriver'
import type { GitService } from '../git/gitService'
import type { SessionCatalog } from '../sessions/sessionCatalog'
import type { SessionStore } from '../store/sessionStore'

/**
 * The session driver over this machine's store, chats and git: what Regent acts through. Built by
 * `createContainer`; `openSession` shows a session's tab (the one residents use).
 */
export function createDriving(o: {
  store: SessionStore
  chat: ChatService
  git: Pick<GitService, 'createWorktree'>
  catalog: Pick<SessionCatalog, 'refresh'>
  tabMover: { recentFirst(): readonly number[] }
  /** The remote windows showing this machine: where "open this session" goes first. */
  virtualContents: Pick<VirtualContentsRegistry, 'list'>
}): SessionDriver {
  const nameOf = (path: string): string => basename(path)
  return new SessionDriver({
    chat: o.chat,
    session: (id) => {
      const found = o.store.getSession(id)
      return found === null || found.archived ? null : { title: found.title ?? found.firstPrompt ?? 'Untitled session' }
    },
    folders: (): FolderSource[] => o.store.allProjects().filter((p) => p.exists).map((p) => ({
      path: p.path, name: nameOf(p.path), branch: p.branch, isRepo: p.repoRoot !== null,
      worktreeOf: p.isWorktree && p.repoRoot !== null ? nameOf(p.repoRoot) : null,
    })),
    createWorktree: (path, request) => o.git.createWorktree(path, request),
    describeFolder: (path, repoName) => ({ path, name: nameOf(path), branch: null, isRepo: true, worktreeOf: repoName }),
    openSession: (id) => { sendOpenSession(o.virtualContents.list(), frontWindow(o.tabMover), id) },
    refresh: () => o.catalog.refresh({ paths: [] }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms) }),
  })
}
