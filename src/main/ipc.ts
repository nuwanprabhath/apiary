import { ipcMain, clipboard, type BrowserWindow } from 'electron'
import { watch } from 'chokidar'
import { projectsDir } from './config'
import { CHANNELS, type AppSettingsPayload } from '@shared/api'
import type { AppService } from './appService'
import type { AppSettings } from './settings'
import { loadSettings, saveSettings } from './settings'

export function registerIpc(
  service: AppService,
  getWindow: () => BrowserWindow | null,
  configRoot: string,
  settingsFile: string,
  onAutoImportIntervalChange?: (intervalMinutes: number | null) => void,
): () => void {
  const send = (channel: string, ...args: unknown[]): void => {
    getWindow()?.webContents.send(channel, ...args)
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
    }
  })
  ipcMain.handle(CHANNELS.settingsSet, async (_e, next: AppSettingsPayload) => {
    const current = loadSettings(settingsFile)
    const merged: AppSettings = {
      ...current,
      claudeBin: next.claudeBin,
      autoImportAll: next.autoImportAll,
      autoImportIntervalMinutes: next.autoImportIntervalMinutes,
      revealActiveInSidebar: next.revealActiveInSidebar,
      searchChatContent: next.searchChatContent,
    }
    saveSettings(settingsFile, merged)
    service.setClaudeBin(merged.claudeBin)
    service.setAutoImportAll(merged.autoImportAll)
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
  ipcMain.handle(CHANNELS.saveImage, (_e, base64: string, mediaType: string) =>
    service.saveImage(base64, mediaType),
  )
  ipcMain.handle(CHANNELS.readImage, (_e, path: string) => service.readImage(path))
  ipcMain.handle(CHANNELS.sendPrompt, (_e, ptyId: string, text: string) => {
    service.sendPrompt(ptyId, text)
  })

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
