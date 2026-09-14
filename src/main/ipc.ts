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
import type { AppSettings } from './settings'
import { loadSettings, saveSettings } from './settings'
import type { UpdateService } from './update/updateService'

export function registerIpc(
  service: AppService,
  getWindow: () => BrowserWindow | null,
  configRoot: string,
  settingsFile: string,
  onAutoImportIntervalChange?: (intervalMinutes: number | null) => void,
  /** Null where there is no updater at all (a dev run, or a platform without one). */
  updater?: UpdateService | null,
): () => void {
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

  ipcMain.handle(CHANNELS.refresh, () => service.refresh())
  ipcMain.handle(CHANNELS.tree, (_e, query: string) => service.tree(query))
  ipcMain.handle(CHANNELS.discovered, async () =>
    (await service.discovered()).map((s) => ({
      sessionId: s.sessionId,
      projectPath: s.projectPath,
      title: s.title ?? s.firstPrompt ?? s.sessionId,
      lastActiveAtMs: s.lastActiveAtMs,
      imported: s.imported,
    })),
  )
  ipcMain.handle(CHANNELS.importSessions, (_e, ids: string[], projects: string[]) =>
    service.importSessions(ids, projects),
  )
  ipcMain.handle(CHANNELS.transcript, (_e, id: string, beforeIndex?: number) =>
    service.transcript(id, beforeIndex),
  )
  ipcMain.handle(CHANNELS.checkConflict, (_e, id: string) => service.checkConflict(id))
  ipcMain.handle(CHANNELS.resume, (_e, id: string, fork: boolean) => service.resume(id, fork))
  ipcMain.handle(CHANNELS.renameSession, async (_e, id: string, title: string) => {
    await service.renameSession(id, title)
    // Nothing on disk changed, so the filesystem watcher will never fire for this — push the
    // same "tree changed" signal it uses so every open view (the sidebar list here, and any
    // other window) picks up the new title immediately instead of only on its next unrelated
    // refresh.
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(CHANNELS.removeSession, async (_e, id: string) => {
    await service.removeSession(id)
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(CHANNELS.openShell, (_e, id: string, tabId: string) => service.openShell(id, tabId))
  ipcMain.handle(CHANNELS.openShellForPty, (_e, id: string, tabId: string) =>
    service.openShellForPty(id, tabId),
  )
  ipcMain.handle(CHANNELS.newSessionInProject, (_e, path: string) =>
    service.newSessionInProject(path),
  )
  ipcMain.handle(CHANNELS.settingsGet, (): AppSettingsPayload => {
    const settings = loadSettings(settingsFile)
    return {
      claudeBin: settings.claudeBin,
      autoImportAll: settings.autoImportAll,
      autoImportIntervalMinutes: settings.autoImportIntervalMinutes,
      revealActiveInSidebar: settings.revealActiveInSidebar,
      searchChatContent: settings.searchChatContent,
      searchSessionNotes: settings.searchSessionNotes,
      terminalShortenPath: settings.terminalShortenPath,
      terminalPathSegments: settings.terminalPathSegments,
      plugins: Object.fromEntries(service.listPlugins().map((p) => [p.id, p.enabled])),
      pluginSettings: Object.fromEntries(service.listPlugins().map((p) => [p.id, p.values])),
      updateAutomaticChecks: settings.updateAutomaticChecks,
      updateCheckIntervalHours: settings.updateCheckIntervalHours,
      updateAutoDownload: settings.updateAutoDownload,
      updateAllowPrerelease: settings.updateAllowPrerelease,
    }
  })
  ipcMain.handle(CHANNELS.settingsSet, async (_e, next: AppSettingsPayload) => {
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
      terminalShortenPath: keep(next.terminalShortenPath, current.terminalShortenPath),
      terminalPathSegments: keep(next.terminalPathSegments, current.terminalPathSegments),
      plugins: keep(next.plugins, current.plugins),
      pluginSettings: keep(next.pluginSettings, current.pluginSettings),
      updateAutomaticChecks: keep(next.updateAutomaticChecks, current.updateAutomaticChecks),
      updateCheckIntervalHours: keep(next.updateCheckIntervalHours, current.updateCheckIntervalHours),
      updateAutoDownload: keep(next.updateAutoDownload, current.updateAutoDownload),
      updateAllowPrerelease: keep(next.updateAllowPrerelease, current.updateAllowPrerelease),
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

  ipcMain.handle(CHANNELS.gitStatus, (_e, key: string, isPtyId: boolean) =>
    service.gitStatus(key, isPtyId),
  )
  ipcMain.handle(CHANNELS.gitListRefs, (_e, key: string, isPtyId: boolean) =>
    service.gitListRefs(key, isPtyId),
  )
  ipcMain.handle(CHANNELS.gitCheckoutBranch, async (_e, key: string, isPtyId: boolean, name: string) => {
    await service.gitCheckoutBranch(key, isPtyId, name)
    // `tree()` reads the `branch` column, which only `refresh()` (via `resolveProject`) writes —
    // without this, the sidebar keeps showing the pre-checkout branch until something else
    // happens to trigger a full refresh.
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(
    CHANNELS.gitCheckoutRemote,
    async (_e, key: string, isPtyId: boolean, remoteRef: string, localName: string) => {
      await service.gitCheckoutRemote(key, isPtyId, remoteRef, localName)
      await service.refresh()
      send(CHANNELS.treeChanged)
    },
  )
  ipcMain.handle(CHANNELS.gitCheckoutDetached, async (_e, key: string, isPtyId: boolean, ref: string) => {
    await service.gitCheckoutDetached(key, isPtyId, ref)
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(
    CHANNELS.gitCreateBranch,
    async (_e, key: string, isPtyId: boolean, name: string, from?: string) => {
      await service.gitCreateBranch(key, isPtyId, name, from)
      await service.refresh()
      send(CHANNELS.treeChanged)
    },
  )
  ipcMain.handle(CHANNELS.gitPull, (_e, key: string, isPtyId: boolean) => service.gitPull(key, isPtyId))
  ipcMain.handle(CHANNELS.gitPush, (_e, key: string, isPtyId: boolean) => service.gitPush(key, isPtyId))
  ipcMain.handle(CHANNELS.gitMerge, async (_e, key: string, isPtyId: boolean, ref: string) => {
    await service.gitMerge(key, isPtyId, ref)
    // Merge changes which commits are on the branch and affects ahead/behind counts, so refresh
    // and signal the tree view to update the displayed branch state — same reason as checkoutBranch.
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(CHANNELS.gitFetch, async (_e, key: string, isPtyId: boolean) => {
    await service.gitFetch(key, isPtyId)
    // Fetch changes ahead/behind counts (by updating remote-tracking refs), so refresh
    // and signal the tree view to update the displayed status.
    await service.refresh()
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(CHANNELS.copyToClipboard, (_e, text: string) => { clipboard.writeText(text) })
  ipcMain.handle(CHANNELS.searchRebuild, async () => { await service.rebuildSearchIndex() })
  ipcMain.handle(CHANNELS.searchStatus, () => ({
    indexed: service.searchIndexCount(),
    notes: service.searchNoteCount(),
  }))
  ipcMain.handle(CHANNELS.pluginBarItems, (_e, key: string, isPtyId: boolean) =>
    service.pluginBarItems(key, isPtyId),
  )
  ipcMain.handle(CHANNELS.pluginBarRefresh, (_e, key: string, isPtyId: boolean) =>
    service.refreshPluginBar(key, isPtyId),
  )
  ipcMain.handle(CHANNELS.pluginList, () => service.listPlugins())
  ipcMain.handle(CHANNELS.pluginRunAction, async (_e, item: PluginBarItemPayload) => {
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
  ipcMain.handle(CHANNELS.setSessionNote, async (_e, id: string, note: string) => {
    await service.setSessionNote(id, note)
    // The note shows in the sidebar's hover card and changes what searches match, so every window
    // needs to re-read the tree — the same signal a rename sends.
    send(CHANNELS.treeChanged)
  })
  ipcMain.handle(CHANNELS.sessionNote, (_e, id: string) => service.sessionNote(id))
  ipcMain.handle(CHANNELS.saveImage, (_e, base64: string, mediaType: string) =>
    service.saveImage(base64, mediaType),
  )
  ipcMain.handle(CHANNELS.readImage, (_e, path: string) => service.readImage(path))
  ipcMain.handle(CHANNELS.sendPrompt, (_e, ptyId: string, text: string) => {
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
    error: null,
    lastCheckedAt: null,
    skippedVersion: null,
  })

  ipcMain.handle(CHANNELS.updateStatus, (): UpdateStatusPayload =>
    updater?.current() ?? noUpdater())
  ipcMain.handle(CHANNELS.updateCheck, async (): Promise<UpdateStatusPayload> =>
    (await updater?.check({ manual: true })) ?? noUpdater())
  ipcMain.handle(CHANNELS.updateDownload, async (): Promise<UpdateStatusPayload> =>
    (await updater?.download()) ?? noUpdater())
  ipcMain.handle(CHANNELS.updateInstall, () => { updater?.install() })
  ipcMain.handle(CHANNELS.updateOpenDownloaded, async () => { await updater?.openDownloaded() })
  ipcMain.handle(CHANNELS.updateSkip, () => {
    updater?.skip()
    // The skip is a settings change, so it has to reach settings.json as well as the service.
    const current = loadSettings(settingsFile)
    saveSettings(settingsFile, { ...current, updateSkippedVersion: updater?.current().skippedVersion ?? null })
  })
  ipcMain.handle(CHANNELS.updateDismiss, () => { updater?.dismiss() })

  ipcMain.on(CHANNELS.ptyWrite, (_e, id: string, data: string) => service.pty.write(id, data))
  ipcMain.on(CHANNELS.ptyResize, (_e, id: string, cols: number, rows: number) =>
    service.pty.resize(id, cols, rows),
  )
  ipcMain.on(CHANNELS.ptyKill, (_e, id: string) => service.pty.kill(id))

  service.pty.onData((id, data) => send(CHANNELS.ptyData, id, data))
  service.pty.onExit((id, code) => send(CHANNELS.ptyExit, id, code))

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
    void watcher.close()
    for (const channel of Object.values(CHANNELS)) {
      ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(channel)
    }
  }
}
