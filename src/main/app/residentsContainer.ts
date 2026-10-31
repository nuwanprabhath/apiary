import { BrowserWindow, webContents, type WebContents } from 'electron'
import { IPC } from '@shared/api'
import type { SessionId } from '@shared/domain/ids'
import type { AccountService } from '../accounts/accountService'
import { createExec } from '../exec/run'
import type { VirtualContentsRegistry } from '../remote/virtualContents'
import { kindLookup } from '../residents/kinds'
import { nodeKindFiles, searchPathFrom } from '../residents/kinds/kindHost'
import { ResidentService } from '../residents/residentService'
import type { SettingsService } from '../settings/settingsService'
import type { UsageFeed } from '../statusBar/claudeUsage/usageFeed'
import type { SessionStore } from '../store/sessionStore'
import { broadcast } from '../windows/broadcast'
import { sendEvent, type EventTarget } from '../windows/sendEvent'
import type { TabRegistry } from '../windows/tabRegistry'
import type { ContainerPaths } from './containerPaths'
import type { KnowledgeParts } from './knowledgeContainer'
import { mraDirIn } from './resourcesDir'

/** A tool check (`python3 --version`, `glab auth status`) that takes longer than this counts as missing. */
const PROBE_TIMEOUT_MS = 15_000

/**
 * The resident agents over this machine's sessions, tabs and default account, built by
 * `createContainer` (and by the contract loopback, so both run the same wiring), over the knowledge
 * index and its digester (`createKnowledge`).
 */
export function createResidents(o: {
  settingsService: SettingsService
  paths: Pick<ContainerPaths, 'residentsDir'>
  store: SessionStore
  accounts: AccountService
  knowledge: Pick<KnowledgeParts, 'service' | 'digester'>
  tabRegistry: TabRegistry
  service: { claudeBin: string | null; plugins: { usage: UsageFeed } }
  ipcState: { tabMover: { recentFirst(): readonly number[] } }
  windowManager: { windowNumberFor(webContentsId: number): number | null }
  /** The remote windows showing this machine at a home machine: where a resident's "open this session" goes first. */
  virtualContents: Pick<VirtualContentsRegistry, 'list'>
  version: string
  /** Where the bundled programs are (`resolveResourcesDir`). */
  resourcesDir: string
}): ResidentService {
  const searchPath = (): string => searchPathFrom(process.env.PATH)
  const kinds = kindLookup({
    mraDir: () => mraDirIn(o.resourcesDir),
    exec: createExec({ scope: 'residents', timeoutMs: PROBE_TIMEOUT_MS, env: { PATH: searchPath() } }),
    searchPath,
    files: nodeKindFiles,
  })
  // The window last in front (or the first, before any was focused): where a resident's "open this session" goes.
  const front = (): WebContents | null => {
    const id = o.ipcState.tabMover.recentFirst().find((n) => (webContents.fromId(n) ?? null) !== null)
    if (id !== undefined) return webContents.fromId(id) ?? null
    return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())?.webContents ?? null
  }
  return new ResidentService({
    settings: {
      get: () => o.settingsService.get().residents,
      set: (list) => { o.settingsService.applyPayload({ residents: list }, new Set()) },
      onChange: (fn) => o.settingsService.onChange((next, prev) => { if (next.residents !== prev.residents) fn() }),
    },
    root: o.paths.residentsDir,
    knowledge: o.knowledge.service,
    digest: o.knowledge.digester,
    usagePercent: () => o.service.plugins.usage.fiveHourPercent(o.accounts.defaultId()),
    claudeBin: () => o.service.claudeBin ?? undefined,
    launchEnv: () => o.accounts.launchEnv(o.accounts.defaultId()),
    tools: {
      session: (id) => {
        const found = o.store.getSession(id)
        return found === null || found.archived ? null : { title: found.title ?? found.firstPrompt ?? 'Untitled session' }
      },
      openSession: (id) => { sendOpenSession(o.virtualContents.list(), front(), id) },
      openTabs: () => o.tabRegistry.list(),
      focusedWindow: () => {
        const target = front()
        return target === null ? null : o.windowManager.windowNumberFor(target.id)
      },
    },
    kindOf: kinds,
    onChanged: (statuses) => { broadcast(IPC.residentsChanged, statuses) },
    onMessage: (push) => { broadcast(IPC.residentMessage, push) },
    version: o.version,
  })
}

/**
 * A session a resident opens goes to the remote windows showing this machine, when any is open: the
 * person is looking at this machine from home, not at its own screen. Otherwise to `front`.
 */
export function sendOpenSession(remoteWindows: readonly (EventTarget & { isDestroyed(): boolean })[], front: EventTarget | null, id: SessionId): void {
  const open = remoteWindows.filter((w) => !w.isDestroyed())
  if (open.length === 0) { sendEvent(front, IPC.openSessionRequested, id); return }
  for (const target of open) sendEvent(target, IPC.openSessionRequested, id)
}
