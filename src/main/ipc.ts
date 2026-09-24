import { ipcMain, clipboard, BrowserWindow, app, shell } from 'electron'
import { watch } from 'chokidar'
import { projectsDir } from './config'
import {
  CHANNELS,
  type AppSettingsPayload,
  type UpdateStatusPayload,
  type PluginBarItemPayload,
} from '@shared/api'
import type { AppService } from './appService'
import { isTabTransfer, UNTITLED_SESSION, type TabTransfer } from '@shared/types'
import type { AppSettings } from './settings'
import { loadSettings, saveSettings, clampRecentHours } from './settings'
import { log, type LogLevel } from './log/logger'
import { configureLogging } from './log/configure'
import type { UpdateService } from './update/updateService'
import { pickWindowAt } from './windowAtPoint'
import type { SessionLayoutStore } from './sessionLayoutStore'
import type { LayoutFlushCoordinator } from './layoutFlushCoordinator'
import type { WindowLayoutReport } from '@shared/types'
import { TabRegistry, focusTab, type OpenTab } from './tabRegistry'
import { classifyActivity } from '@shared/activity'
import { ClaudeSessionTracker } from './claudeSessionTracker'
import { invalidateMrStatuses } from './git/mrStatusCache'
import { renameInClaude } from './claudeRename'
import { join } from 'node:path'

/**
 * How often, at most, the Active section's activity broadcast goes out while a pty is producing
 * output. See the comment where it is used.
 */
const ACTIVITY_BROADCAST_MS = 500

export function registerIpc(
  service: AppService,
  getWindow: () => BrowserWindow | null,
  configRoot: string,
  settingsFile: string,
  onAutoImportIntervalChange?: (intervalMinutes: number | null) => void,
  /** Null where there is no updater at all (a dev run, or a platform without one). */
  updater?: UpdateService | null,
  /** Null where the store has not been constructed yet (mirrors `updater` above). */
  sessionLayoutStore?: SessionLayoutStore | null,
  /** Told about every incoming `reportLayout` so `before-quit` can wait for a specific window's. */
  layoutFlushCoordinator?: LayoutFlushCoordinator | null,
  /** Opens a tab in a window of its own. Injected so this module never imports the window code. */
  openDetachedWindow?: (tab: TabTransfer, at: { x: number; y: number }) => void,
  /** Where every window's open tabs are recorded, for the Active section. Null where the registry
   *  has not been constructed yet, mirroring `sessionLayoutStore` above. */
  tabRegistry?: TabRegistry | null,
  /** Maps the sending window's `webContents.id` to the window number `reportTabs` should file
   *  under, so `TabRegistry` (keyed by window number, same as `SessionLayoutStore`) never has to
   *  know about webContents ids at all. Populated in `main/index.ts`, next to where a window's
   *  number is minted. */
  windowNumberFor?: (webContentsId: number) => number | null,
): () => void {
  /**
   * Every `invoke` handler, wrapped so its failures and its slow cases are recorded.
   *
   * This is the instrumentation the "Open installer" bug needed and did not have: the renderer
   * reported `Error invoking remote method '…': reply was never sent`, which says something about
   * Electron's plumbing and nothing about what the handler was doing when it stopped. A channel
   * name, a duration and the error are enough to tell a thrown error from one that never
   * returned, which is the distinction that took a day of guessing.
   *
   * Wrapping centrally rather than per handler is deliberate: there are fifty of these, and the
   * one that matters next will be whichever nobody thought to instrument.
   */
  type Handler = Parameters<typeof ipcMain.handle>[1]


  const handle = (channel: string, fn: Handler): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      const started = Date.now()
      try {
        const result: unknown = await fn(event, ...args)
        const ms = Date.now() - started
        // Only the slow ones: logging every call would bury the interesting lines in traffic.
        if (ms > 2000) log.warn('ipc', 'slow handler', { channel, ms })
        return result
      } catch (error) {
        // `warn`, not `error`: a rejecting handler is usually an *expected* failure on its way to
        // being shown to the user — asking for git status in a folder that is not a repository
        // rejects every time you click such a session, and a log where that is an error has no
        // room left for the things nobody handled. `error` is reserved for exactly those: see the
        // renderer's uncaught-error net.
        log.warn('ipc', 'handler failed', { channel, ms: Date.now() - started, error })
        throw error
      }
    })
  }

  /**
   * Broadcasts to every window, not just the focused one.
   *
   * With more than one window open, terminal output and tree changes belong to whichever windows
   * are showing that session — which is not necessarily the one in front, and can be several at
   * once. Sending to a single window would leave a background window's terminal frozen until it
   * was clicked. Destroyed windows are skipped rather than filtered: a window can close between
   * this list being taken and the send landing.
   */
  const send = (channel: string, ...args: unknown[]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args)
    }
  }

  handle(CHANNELS.refresh, async () => {
    // Refresh also means "check merge requests again": the likeliest reason to press it is having
    // just merged one. Every view re-asks when told the cache is gone.
    invalidateMrStatuses()
    send(CHANNELS.mrStatusesInvalidated)
    log.info('mr-status', 'invalidated by refresh')
    return service.refresh()
  })
  handle(CHANNELS.tree, () => service.tree())
  handle(CHANNELS.searchContent, (_e, query: string) => service.searchSessions(query))
  handle(CHANNELS.discovered, async () =>
    (await service.discovered()).map((s) => ({
      sessionId: s.sessionId,
      projectPath: s.projectPath,
      title: s.title ?? s.firstPrompt ?? UNTITLED_SESSION,
      lastActiveAtMs: s.lastActiveAtMs,
      imported: s.imported,
    })),
  )
  handle(CHANNELS.importSessions, (_e, ids: string[], projects: string[]) =>
    service.importSessions(ids, projects),
  )
  handle(CHANNELS.transcript, (_e, id: string, beforeIndex?: number) =>
    service.transcript(id, beforeIndex),
  )
  handle(CHANNELS.checkConflict, (_e, id: string) => service.checkConflict(id))
  handle(CHANNELS.resume, (_e, id: string) => service.resume(id))
  handle(CHANNELS.reportLayout, (e, report: WindowLayoutReport) => {
    sessionLayoutStore?.reportLayout(report)
    // Resolves `before-quit`'s bounded wait for this specific window, when one is in progress.
    layoutFlushCoordinator?.onReport(e.sender.id)
  })
  ipcMain.on(
    CHANNELS.reportTabs,
    (e, tabs: { key: string; view: 'transcript' | 'terminal'; ptyId: string | null }[]) => {
      const windowNumber = windowNumberFor?.(e.sender.id) ?? null
      if (windowNumber === null || !tabRegistry) return
      tabRegistry.report(windowNumber, tabs.map((t): OpenTab => ({ ...t, windowNumber })))
    },
  )
  handle(CHANNELS.activeTabs, () => (tabRegistry?.list() ?? []).map((t) => ({
    windowNumber: t.windowNumber,
    key: t.key,
    view: t.view,
    status: classifyActivity(
      // The rendered screen, not the raw stream — see `classifyActivity` and `pty/screen.ts`.
      t.ptyId !== null ? service.pty.screen(t.ptyId) : '',
      t.ptyId !== null ? service.pty.lastOutputAt(t.ptyId) : 0,
      Date.now(),
      t.ptyId !== null && service.pty.has(t.ptyId),
    ),
  })))
  handle(CHANNELS.focusTab, (_e, windowNumber: number, key: string) => {
    focusTab(BrowserWindow.getAllWindows(), windowNumber, key)
  })
  handle(CHANNELS.renameSession, async (_e, id: string, title: string) => {
    await service.renameSession(id, title)
    // And in Claude's own record, where the VS Code extension and /resume read the name — only for
    // a session running here, and only once it is safe to type into (see claudeRename.ts). Not
    // awaited: it can wait up to a minute for Claude to go idle, and the rename in Apiary is done.
    if (title.trim() !== '') {
      void renameInClaude({
        sessions: () => sessionTracker.current(),
        screen: (ptyId) => service.pty.screen(ptyId),
        write: (ptyId, data) => { service.pty.write(ptyId, data) },
        isAlive: (ptyId) => service.pty.has(ptyId),
      }, id, title).catch(() => { /* the Apiary rename already succeeded */ })
    }
    // Nothing on disk changed, so the filesystem watcher will never fire for this — push the
    // same "tree changed" signal it uses so every open view (the sidebar list here, and any
    // other window) picks up the new title immediately instead of only on its next unrelated
    // refresh.
    send(CHANNELS.treeChanged)
  })
  handle(CHANNELS.removeSession, async (_e, id: string) => {
    await service.removeSession(id)
    send(CHANNELS.treeChanged)
  })
  handle(CHANNELS.moveSession, async (_e, id: string, targetPath: string) => {
    await service.moveSession(id, targetPath)
    // Same signal a rename or an archive sends: the sidebar re-reads the (unfiltered, cached)
    // tree, which now shows the session under its new project instead of the old one.
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  handle(CHANNELS.openShell, (_e, id: string, tabId: string) => service.openShell(id, tabId))
  handle(CHANNELS.openShellForPty, (_e, id: string, tabId: string) =>
    service.openShellForPty(id, tabId),
  )
  handle(CHANNELS.forkSession, (_e, id: string) => service.forkSession(id))
  handle(CHANNELS.newSessionInProject, (_e, path: string) =>
    service.newSessionInProject(path),
  )
  handle(CHANNELS.settingsGet, (): AppSettingsPayload => {
    const settings = loadSettings(settingsFile)
    return {
      claudeBin: settings.claudeBin,
      autoImportAll: settings.autoImportAll,
      autoImportIntervalMinutes: settings.autoImportIntervalMinutes,
      revealActiveInSidebar: settings.revealActiveInSidebar,
      searchChatContent: settings.searchChatContent,
      searchSessionNotes: settings.searchSessionNotes,
      recentSectionEnabled: settings.recentSectionEnabled,
      recentSectionHours: settings.recentSectionHours,
      terminalShortenPath: settings.terminalShortenPath,
      terminalPathSegments: settings.terminalPathSegments,
      diagnosticsEnabled: settings.diagnosticsEnabled,
      logRetentionDays: settings.logRetentionDays,
      logMaxSizeMb: settings.logMaxSizeMb,
      plugins: Object.fromEntries(service.listPlugins().map((p) => [p.id, p.enabled])),
      pluginSettings: Object.fromEntries(service.listPlugins().map((p) => [p.id, p.values])),
      updateAutomaticChecks: settings.updateAutomaticChecks,
      updateCheckIntervalHours: settings.updateCheckIntervalHours,
      updateAutoDownload: settings.updateAutoDownload,
      updateAllowPrerelease: settings.updateAllowPrerelease,
    }
  })
  handle(CHANNELS.settingsSet, async (_e, next: AppSettingsPayload) => {
    const current = loadSettings(settingsFile)
    /**
     * A field the payload does not carry means "leave it alone", never "off".
     *
     * The payload is typed, but it arrives over IPC from a renderer that is not guaranteed to be
     * the same build as this process — during a dev reload, or an update that reloads the window
     * — and a key the sender has never heard of simply is not there. Assigning it straight across
     * then wrote `undefined`, which is falsy: the feature switched off in this process, its index
     * was wiped as a switch-off is meant to do, and `JSON.stringify` dropped the undefined key on
     * the way to disk so `settings.json` still said the feature was on. Nothing about that is
     * visible from the outside. This is the bug that made session notes stop being indexed.
     */
    const keep = <T>(value: T | undefined, fallback: T): T => value ?? fallback
    const merged: AppSettings = {
      ...current,
      // `claudeBin` is the exception: null is a real value there, meaning "find it on PATH".
      claudeBin: next.claudeBin === undefined ? current.claudeBin : next.claudeBin,
      autoImportAll: keep(next.autoImportAll, current.autoImportAll),
      autoImportIntervalMinutes: next.autoImportIntervalMinutes === undefined
        ? current.autoImportIntervalMinutes
        : next.autoImportIntervalMinutes,
      revealActiveInSidebar: keep(next.revealActiveInSidebar, current.revealActiveInSidebar),
      searchChatContent: keep(next.searchChatContent, current.searchChatContent),
      searchSessionNotes: keep(next.searchSessionNotes, current.searchSessionNotes),
      recentSectionEnabled: keep(next.recentSectionEnabled, current.recentSectionEnabled),
      // Clamped here rather than trusted as `keep` would leave it: `next.recentSectionHours` is
      // typed `number` but arrives over IPC from a renderer that is not guaranteed to have
      // validated it (a stale build, or devtools) — see `clampRecentHours`.
      recentSectionHours: next.recentSectionHours === undefined
        ? current.recentSectionHours
        : clampRecentHours(next.recentSectionHours),
      terminalShortenPath: keep(next.terminalShortenPath, current.terminalShortenPath),
      terminalPathSegments: keep(next.terminalPathSegments, current.terminalPathSegments),
      plugins: keep(next.plugins, current.plugins),
      pluginSettings: keep(next.pluginSettings, current.pluginSettings),
      updateAutomaticChecks: keep(next.updateAutomaticChecks, current.updateAutomaticChecks),
      updateCheckIntervalHours: keep(next.updateCheckIntervalHours, current.updateCheckIntervalHours),
      updateAutoDownload: keep(next.updateAutoDownload, current.updateAutoDownload),
      updateAllowPrerelease: keep(next.updateAllowPrerelease, current.updateAllowPrerelease),
      diagnosticsEnabled: keep(next.diagnosticsEnabled, current.diagnosticsEnabled),
      logRetentionDays: keep(next.logRetentionDays, current.logRetentionDays),
      logMaxSizeMb: keep(next.logMaxSizeMb, current.logMaxSizeMb),
    }
    saveSettings(settingsFile, merged)
    // The schedule has to follow the settings immediately: switching checks off and having one
    // fire ten minutes later is the kind of thing that makes a toggle look broken.
    updater?.settingsChanged()
    service.setClaudeBin(merged.claudeBin)
    service.setAutoImportAll(merged.autoImportAll)
    service.setSearchChatContent(merged.searchChatContent)
    service.setSearchSessionNotes(merged.searchSessionNotes)
    for (const [id, enabled] of Object.entries(merged.plugins)) {
      service.setPluginEnabled(id, enabled)
    }
    for (const [id, values] of Object.entries(merged.pluginSettings)) {
      service.setPluginSettings(id, values)
    }
    // Switching a plugin off changes what every open bar should show, and nothing else would tell
    // the windows: the bar only re-reads on a branch change or on this signal.
    send(CHANNELS.pluginsChanged)
    service.setPromptPath({
      enabled: merged.terminalShortenPath,
      segments: merged.terminalPathSegments,
    })
    // Applied immediately: switching diagnostics off has to stop writing now, not at next launch,
    // or "off" is a promise the app keeps only eventually.
    configureLogging(merged)
    log.info('settings', 'settings saved', {
      diagnosticsEnabled: merged.diagnosticsEnabled,
      terminalShortenPath: merged.terminalShortenPath,
      terminalPathSegments: merged.terminalPathSegments,
    })
    // Switching content search on should not mean waiting until the next rescan to be able to use
    // it, so the first pass starts now; it is a background chore either way.
    if (merged.searchChatContent) void service.updateSearchIndex()
    onAutoImportIntervalChange?.(merged.autoImportIntervalMinutes)
    // If autoImportAll was just switched ON, import everything right away.
    if (merged.autoImportAll && !current.autoImportAll) {
      await service.importAllDiscovered()
      send(CHANNELS.treeChanged)
    }
  })

  handle(CHANNELS.gitStatus, (_e, key: string, isPtyId: boolean) =>
    service.gitStatus(key, isPtyId),
  )
  handle(CHANNELS.gitListRefs, (_e, key: string, isPtyId: boolean) =>
    service.gitListRefs(key, isPtyId),
  )

  handle(CHANNELS.gitlabMrRefStatus, (_e, key: string, isPtyId: boolean, iids: number[]) =>
    service.gitlabMrRefStatus(key, isPtyId, iids),
  )
  handle(CHANNELS.gitCheckoutBranch, async (_e, key: string, isPtyId: boolean, name: string) => {
    const outcome = await service.gitCheckoutBranch(key, isPtyId, name)
    // `tree()` reads the `branch` column, which only `refresh()` (via `resolveProject`) writes —
    // without this, the sidebar keeps showing the pre-checkout branch until something else
    // happens to trigger a full refresh. Skipped when nothing was checked out.
    if (outcome.ok) {
      await service.refresh()
      send(CHANNELS.treeChanged)
    }
    return outcome
  })
  handle(CHANNELS.gitPullWorktree, async (_e, key: string, isPtyId: boolean, branch: string) => {
    const path = await service.gitPullWorktree(key, isPtyId, branch)
    // The worktree that was pulled is a project in its own right here, and its ahead/behind counts
    // have just changed.
    await service.refresh()
    send(CHANNELS.treeChanged)
    return path
  })
  handle(CHANNELS.newSessionInWorktree, (_e, key: string, isPtyId: boolean, branch: string) =>
    service.newSessionInWorktree(key, isPtyId, branch),
  )
  handle(
    CHANNELS.gitCheckoutRemote,
    async (_e, key: string, isPtyId: boolean, remoteRef: string, localName: string) => {
      await service.gitCheckoutRemote(key, isPtyId, remoteRef, localName)
      await service.refresh()
      send(CHANNELS.treeChanged)
    },
  )
  handle(CHANNELS.gitCheckoutDetached, async (_e, key: string, isPtyId: boolean, ref: string) => {
    await service.gitCheckoutDetached(key, isPtyId, ref)
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  handle(
    CHANNELS.gitCreateBranch,
    async (_e, key: string, isPtyId: boolean, name: string, from?: string) => {
      await service.gitCreateBranch(key, isPtyId, name, from)
      await service.refresh()
      send(CHANNELS.treeChanged)
    },
  )
  handle(CHANNELS.gitPull, (_e, key: string, isPtyId: boolean) => service.gitPull(key, isPtyId))
  handle(CHANNELS.gitPullFolder, async (_e, path: string) => {
    const outcome = await service.gitPullFolder(path)
    // New commits change ahead/behind and possibly what is checked out, so the tree is re-read —
    // the same reason gitMerge below refreshes.
    if (outcome.commits > 0) {
      await service.refresh()
      send(CHANNELS.treeChanged)
    }
    return outcome
  })
  handle(CHANNELS.gitPush, (_e, key: string, isPtyId: boolean) => service.gitPush(key, isPtyId))
  handle(CHANNELS.gitMerge, async (_e, key: string, isPtyId: boolean, ref: string) => {
    await service.gitMerge(key, isPtyId, ref)
    // Merge changes which commits are on the branch and affects ahead/behind counts, so refresh
    // and signal the tree view to update the displayed branch state — same reason as checkoutBranch.
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  handle(CHANNELS.gitFetch, async (_e, key: string, isPtyId: boolean) => {
    await service.gitFetch(key, isPtyId)
    // Fetch changes ahead/behind counts (by updating remote-tracking refs), so refresh
    // and signal the tree view to update the displayed status.
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  handle(CHANNELS.vsCodeAvailable, () => service.vsCodeAvailable())
  handle(CHANNELS.openInVsCode, (_e, key: string, isPtyId: boolean) => service.openInVsCode(key, isPtyId))
  handle(CHANNELS.copyToClipboard, (_e, text: string) => { clipboard.writeText(text) })
  handle(CHANNELS.searchRebuild, async () => { await service.rebuildSearchIndex() })
  handle(CHANNELS.searchStatus, () => ({
    indexed: service.searchIndexCount(),
    notes: service.searchNoteCount(),
  }))
  handle(CHANNELS.pluginBarItems, (_e, key: string, isPtyId: boolean) =>
    service.pluginBarItems(key, isPtyId),
  )
  handle(CHANNELS.pluginBarRefresh, (_e, key: string, isPtyId: boolean) =>
    service.refreshPluginBar(key, isPtyId),
  )
  handle(CHANNELS.pluginList, () => service.listPlugins())
  handle(CHANNELS.pluginRunAction, async (_e, item: PluginBarItemPayload) => {
    if (item.action.kind !== 'open-url') return
    /*
     * Checked here rather than trusted from the renderer.
     *
     * The URL originates in a plugin, but it arrives back over IPC, and `shell.openExternal` will
     * happily hand the OS anything — `file:`, and on some platforms schemes that run things. Only
     * http(s) is ever opened, so the worst a compromised renderer can do with this channel is open
     * a web page.
     */
    let url: URL
    try {
      url = new URL(item.action.url)
    } catch {
      return
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
    await shell.openExternal(url.toString())
  })
  handle(CHANNELS.setSessionNote, async (_e, id: string, note: string) => {
    await service.setSessionNote(id, note)
    // The note shows in the sidebar's hover card and changes what searches match, so every window
    // needs to re-read the tree — the same signal a rename sends.
    send(CHANNELS.treeChanged)
  })
  handle(CHANNELS.sessionNote, (_e, id: string) => service.sessionNote(id))
  handle(CHANNELS.saveImage, (_e, base64: string, mediaType: string) =>
    service.saveImage(base64, mediaType),
  )
  handle(CHANNELS.readImage, (_e, path: string) => service.readImage(path))
  handle(CHANNELS.sendPrompt, (_e, ptyId: string, text: string) => {
    service.sendPrompt(ptyId, text)
  })

  /**
   * Updater. Every handler tolerates there being no updater at all — a dev run has none, and the
   * renderer is the same code either way, so it asks and gets an honest "unsupported" back rather
   * than needing to know which build it is running in.
   */
  const noUpdater = (): UpdateStatusPayload => ({
    phase: 'error',
    capability: { kind: 'unsupported', reason: 'Running from source — updates apply to installed builds only.' },
    currentVersion: app.getVersion(),
    availableVersion: null,
    releaseNotes: null,
    releaseUrl: null,
    progressPercent: null,
    downloadedPath: null,
    install: null,
    openResult: null,
    error: null,
    lastCheckedAt: null,
    skippedVersion: null,
  })

  handle(CHANNELS.updateStatus, (): UpdateStatusPayload =>
    updater?.current() ?? noUpdater())
  handle(CHANNELS.updateCheck, async (): Promise<UpdateStatusPayload> =>
    (await updater?.check({ manual: true })) ?? noUpdater())
  handle(CHANNELS.updateDownload, async (): Promise<UpdateStatusPayload> =>
    (await updater?.download()) ?? noUpdater())
  handle(CHANNELS.updateInstall, () => { updater?.install() })
  handle(CHANNELS.updateOpenDownloaded, async () =>
    (await updater?.openDownloaded()) ?? { ok: 'failed', reason: 'Running from source — there is no updater.' })
  handle(CHANNELS.updateSkip, () => {
    updater?.skip()
    // The skip is a settings change, so it has to reach settings.json as well as the service.
    const current = loadSettings(settingsFile)
    saveSettings(settingsFile, { ...current, updateSkippedVersion: updater?.current().skippedVersion ?? null })
  })
  handle(CHANNELS.updateDismiss, () => { updater?.dismiss() })

  ipcMain.on(CHANNELS.ptyWrite, (_e, id: string, data: string) => service.pty.write(id, data))
  ipcMain.on(CHANNELS.ptyResize, (_e, id: string, cols: number, rows: number) =>
    service.pty.resize(id, cols, rows),
  )
  ipcMain.on(CHANNELS.ptyKill, (_e, id: string) => service.pty.kill(id))
  handle(CHANNELS.ptySnapshot, (_e, id: string) => service.pty.snapshot(id))

  // Which session each Claude terminal is on, followed through /clear, /resume and /rename. The
  // Active section is keyed by these as well, so it is told too.
  const sessionTracker = new ClaudeSessionTracker({
    sessionsDir: join(configRoot, 'sessions'),
    pids: () => service.pty.tuiPids(),
    onChange: (sessions) => {
      send(CHANNELS.ptySessionsChanged, sessions)
      send(CHANNELS.activeTabsChanged)
    },
  })
  sessionTracker.start()
  handle(CHANNELS.ptySessions, () => sessionTracker.current())

  handle(CHANNELS.logStatus, () => log.status())
  handle(CHANNELS.logClear, () => { log.clear(); return log.status() })
  handle(CHANNELS.logReveal, async () => {
    const { dir } = log.status()
    // `openPath` on a directory is the one case where handing it to the desktop is right: every
    // platform has something that opens a folder. Revealing the active file instead would show
    // the folder *and* select a file the user is about to be told to attach.
    const error = await shell.openPath(dir)
    if (error !== '') shell.showItemInFolder(dir)
    return dir
  })
  /**
   * The renderer's window into the same log. Sent rather than invoked: a log line is never
   * something the UI should wait on, and a renderer that is logging an error is already having a
   * bad enough time without a round trip.
   */
  ipcMain.on(CHANNELS.logWrite, (_e, level: LogLevel, scope: string, message: string, fields?: Record<string, unknown>) => {
    log.log(level, `renderer:${scope}`, message, fields)
  })
  handle(CHANNELS.ptyRunning, (_e, ids: string[]) => ids.filter((id) => service.pty.has(id)))

  /**
   * Moving a session tab between windows.
   *
   * Decided here, from where the pointer was released, because there is no drop event to decide it
   * from. An HTML5 drag started in one `BrowserWindow` delivers no `dragover` or `drop` to another
   * — the receiving window never hears about the gesture at all — so the only part of a
   * cross-window drag that reaches any of our code is `dragend` in the window it started in. That
   * carries screen coordinates, and screen coordinates are enough: see `pickWindowAt`.
   */

  /** webContents ids, most recently focused first — `pickWindowAt`'s stand-in for z-order. */
  const focusOrder: number[] = []
  const rememberFocus = (win: BrowserWindow): void => {
    const id = win.webContents.id
    const at = focusOrder.indexOf(id)
    if (at !== -1) focusOrder.splice(at, 1)
    focusOrder.unshift(id)
  }
  app.on('browser-window-focus', (_e, win) => { rememberFocus(win) })

  /** Tells every window but `keeper` that a tab it may be showing now belongs somewhere else. */
  const announceClaimed = (key: string, keeper: number | null): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.id === keeper) continue
      win.webContents.send(CHANNELS.tabClaimed, key)
    }
  }

  const windowUnder = (at: { x: number; y: number }): BrowserWindow | null => {
    const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
    const id = pickWindowAt(
      windows.map((w) => ({ id: w.webContents.id, ...w.getBounds(), visible: w.isVisible() })),
      focusOrder,
      at,
    )
    return windows.find((w) => w.webContents.id === id) ?? null
  }

  handle(CHANNELS.tabDropped, (e, tab: unknown, at: { x: number; y: number }) => {
    if (!isTabTransfer(tab)) throw new Error('Not a tab.')
    const { key } = tab
    const target = windowUnder(at)
    // The whole decision, because this gesture shipped once doing nothing at all and there was
    // no way to tell from outside whether the drop had even been noticed.
    log.info('tabs', 'tab dropped', {
      at,
      from: e.sender.id,
      target: target?.webContents.id ?? null,
      outcome: target === null ? 'detach' : target.webContents.id === e.sender.id ? 'same-window' : 'move',
    })
    // Released over the window it came from — the transcript, the sidebar, anywhere that is not a
    // tab strip. Nothing happened, and tearing a window off for that would be a surprise.
    if (target === null ? false : target.webContents.id === e.sender.id) return

    if (target !== null) {
      target.webContents.send(CHANNELS.tabAdopt, tab)
      // Brought to the front: the tab is now there, and a move whose result is behind another
      // window looks exactly like a move that did not happen.
      target.focus()
      announceClaimed(key, target.webContents.id)
      return
    }

    // Dropped on the desktop: a window of its own. Announced before the window is made — see below.
    announceClaimed(key, null)
    openDetachedWindow?.(tab, at)
  })

  handle(CHANNELS.tabAdoptHere, (e, tab: unknown) => {
    if (!isTabTransfer(tab)) throw new Error('Not a tab.')
    log.info('tabs', 'tab dropped on a strip in another window', { to: e.sender.id })
    announceClaimed(tab.key, e.sender.id)
    e.sender.send(CHANNELS.tabAdopt, tab)
  })

  handle(CHANNELS.tabDetach, (_e, tab: unknown, at: { x: number; y: number }) => {
    if (!isTabTransfer(tab)) throw new Error('Not a tab.')
    // Announced before the window is made, not after: the new window has not loaded its renderer
    // yet and so cannot hear anything, and a claim arriving once it *has* would tell it to close
    // the very tab it exists to show. Nothing is lost in the gap — the pty keeps running whether
    // or not a view is attached to it.
    announceClaimed(tab.key, null)
    openDetachedWindow?.(tab, at)
  })

  service.pty.onData((id, data) => send(CHANNELS.ptyData, id, data))
  service.pty.onExit((id, code) => send(CHANNELS.ptyExit, id, code))
  // A pty's own data/exit changes what `classifyActivity` would say about it without any window
  // re-reporting its tabs — a long-idle session finally going quiet, or exiting outright — so the
  // Active section's dots have to be re-broadcast on those too, not just on `tabRegistry.onChange`.
  //
  // Coalesced, because pty output is not an event — it is a stream. Broadcasting per chunk meant
  // a build log in one terminal put out hundreds of broadcasts a second, and *each* one makes
  // every open window call `activeTabs`, which replays up to 256KB per tab (`REPLAY_BYTES`) and
  // runs a global ANSI regex plus a split over all of it. It also re-sorted the Recent section
  // continuously, which is the reflow the hover card already has to survive.
  //
  // Leading edge, then at most one broadcast per interval: the first chunk after a quiet period
  // flips the dot to `running` immediately, and the trailing call is what makes the *last* chunk
  // count — without it a session that stops producing output would sit showing `running` until
  // something unrelated happened to broadcast. Two seconds is `classifyActivity`'s running/idle
  // boundary, so 500ms is comfortably inside the window a status change has to be noticed in.
  let activityTimer: NodeJS.Timeout | null = null
  let activityPending = false
  const broadcastActivity = (): void => {
    if (activityTimer !== null) { activityPending = true; return }
    send(CHANNELS.activeTabsChanged)
    activityTimer = setTimeout(() => {
      activityTimer = null
      if (activityPending) { activityPending = false; broadcastActivity() }
    }, ACTIVITY_BROADCAST_MS)
  }
  // Not coalesced: a tab opening or closing is a user action, rare and immediately visible, and
  // delaying it by up to half a second would be felt.
  tabRegistry?.onChange(() => send(CHANNELS.activeTabsChanged))
  service.pty.onData(broadcastActivity)
  service.pty.onExit(broadcastActivity)

  // New session files appear without a restart; debounce because Claude writes often.
  let timer: NodeJS.Timeout | null = null
  const watcher = watch(projectsDir(configRoot), {
    depth: 2,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  })
  const onChange = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void service.refresh().then(() => send(CHANNELS.treeChanged))
    }, 1000)
  }
  watcher.on('add', onChange).on('change', onChange).on('unlink', onChange)

  return () => {
    if (timer) clearTimeout(timer)
    if (activityTimer !== null) { clearTimeout(activityTimer); activityTimer = null }
    void watcher.close()
    for (const channel of Object.values(CHANNELS)) {
      ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(channel)
    }
  }
}
