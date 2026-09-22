import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, type ApiaryApi } from '@shared/api'

function subscribe<A extends unknown[]>(
  channel: string,
  cb: (...args: A) => void,
): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ApiaryApi = {
  refresh: () => ipcRenderer.invoke(CHANNELS.refresh),
  tree: () => ipcRenderer.invoke(CHANNELS.tree),
  searchContent: (query) => ipcRenderer.invoke(CHANNELS.searchContent, query),
  discovered: () => ipcRenderer.invoke(CHANNELS.discovered),
  importSessions: (ids, projects) => ipcRenderer.invoke(CHANNELS.importSessions, ids, projects),
  transcript: (id, beforeIndex) => ipcRenderer.invoke(CHANNELS.transcript, id, beforeIndex),
  checkConflict: (id) => ipcRenderer.invoke(CHANNELS.checkConflict, id),
  resume: (id) => ipcRenderer.invoke(CHANNELS.resume, id),
  reportLayout: (report) => ipcRenderer.invoke(CHANNELS.reportLayout, report),
  reportTabs: (tabs) => ipcRenderer.send(CHANNELS.reportTabs, tabs),
  activeTabs: () => ipcRenderer.invoke(CHANNELS.activeTabs),
  onActiveTabsChanged: (cb) => subscribe(CHANNELS.activeTabsChanged, cb),
  focusTab: (windowNumber, key) => ipcRenderer.invoke(CHANNELS.focusTab, windowNumber, key),
  onSelectTab: (cb) => subscribe(CHANNELS.selectTab, cb),
  renameSession: (id, title) => ipcRenderer.invoke(CHANNELS.renameSession, id, title),
  removeSession: (id) => ipcRenderer.invoke(CHANNELS.removeSession, id),
  moveSession: (id, path) => ipcRenderer.invoke(CHANNELS.moveSession, id, path),
  openShell: (id, tabId) => ipcRenderer.invoke(CHANNELS.openShell, id, tabId),
  openShellForPty: (id, tabId) => ipcRenderer.invoke(CHANNELS.openShellForPty, id, tabId),
  newSessionInProject: (path) => ipcRenderer.invoke(CHANNELS.newSessionInProject, path),
  forkSession: (id) => ipcRenderer.invoke(CHANNELS.forkSession, id),
  logStatus: () => ipcRenderer.invoke(CHANNELS.logStatus),
  logReveal: () => ipcRenderer.invoke(CHANNELS.logReveal),
  logClear: () => ipcRenderer.invoke(CHANNELS.logClear),
  logWrite: (level, scope, message, fields) =>
    ipcRenderer.send(CHANNELS.logWrite, level, scope, message, fields),
  tabDropped: (tab, at) => ipcRenderer.invoke(CHANNELS.tabDropped, tab, at),
  tabDetach: (tab, at) => ipcRenderer.invoke(CHANNELS.tabDetach, tab, at),
  onTabAdopt: (cb) => subscribe(CHANNELS.tabAdopt, cb),
  onTabClaimed: (cb) => subscribe(CHANNELS.tabClaimed, cb),
  onRequestLayoutFlush: (cb) => subscribe(CHANNELS.requestLayoutFlush, cb),
  onNewSessionStarted: (cb) => subscribe(CHANNELS.newSessionStarted, cb),
  ptyWrite: (id, data) => ipcRenderer.send(CHANNELS.ptyWrite, id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send(CHANNELS.ptyResize, id, cols, rows),
  ptyKill: (id) => ipcRenderer.send(CHANNELS.ptyKill, id),
  ptySnapshot: (id) => ipcRenderer.invoke(CHANNELS.ptySnapshot, id),
  ptyRunning: (ids) => ipcRenderer.invoke(CHANNELS.ptyRunning, ids),
  onPtyData: (cb) => subscribe(CHANNELS.ptyData, cb),
  onPtyExit: (cb) => subscribe(CHANNELS.ptyExit, cb),
  onTreeChanged: (cb) => subscribe(CHANNELS.treeChanged, cb),
  onOpenImportDialog: (cb) => subscribe(CHANNELS.openImportDialog, cb),
  settingsGet: () => ipcRenderer.invoke(CHANNELS.settingsGet),
  settingsSet: (settings) => ipcRenderer.invoke(CHANNELS.settingsSet, settings),
  onOpenSettingsDialog: (cb) => subscribe(CHANNELS.openSettingsDialog, cb),
  onToggleSidebar: (cb) => subscribe(CHANNELS.toggleSidebar, cb),
  gitStatus: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitStatus, key, isPtyId),
  gitListRefs: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitListRefs, key, isPtyId),
  gitlabMrRefStatus: (key, isPtyId, iids) =>
    ipcRenderer.invoke(CHANNELS.gitlabMrRefStatus, key, isPtyId, iids),
  gitCheckoutBranch: (key, isPtyId, name) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutBranch, key, isPtyId, name),
  gitPullWorktree: (key, isPtyId, branch) =>
    ipcRenderer.invoke(CHANNELS.gitPullWorktree, key, isPtyId, branch),
  newSessionInWorktree: (key, isPtyId, branch) =>
    ipcRenderer.invoke(CHANNELS.newSessionInWorktree, key, isPtyId, branch),
  gitCheckoutRemote: (key, isPtyId, remoteRef, localName) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutRemote, key, isPtyId, remoteRef, localName),
  gitCheckoutDetached: (key, isPtyId, ref) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutDetached, key, isPtyId, ref),
  gitCreateBranch: (key, isPtyId, name, from) =>
    ipcRenderer.invoke(CHANNELS.gitCreateBranch, key, isPtyId, name, from),
  gitPull: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitPull, key, isPtyId),
  gitPullFolder: (path) => ipcRenderer.invoke(CHANNELS.gitPullFolder, path),
  gitPush: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitPush, key, isPtyId),
  gitMerge: (key, isPtyId, ref) => ipcRenderer.invoke(CHANNELS.gitMerge, key, isPtyId, ref),
  gitFetch: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitFetch, key, isPtyId),
  vsCodeAvailable: () => ipcRenderer.invoke(CHANNELS.vsCodeAvailable),
  openInVsCode: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.openInVsCode, key, isPtyId),
  copyToClipboard: (text) => ipcRenderer.invoke(CHANNELS.copyToClipboard, text),
  searchRebuild: () => ipcRenderer.invoke(CHANNELS.searchRebuild),
  searchStatus: () => ipcRenderer.invoke(CHANNELS.searchStatus),
  saveImage: (base64, mediaType) => ipcRenderer.invoke(CHANNELS.saveImage, base64, mediaType),
  readImage: (path) => ipcRenderer.invoke(CHANNELS.readImage, path),
  sendPrompt: (ptyId, text) => ipcRenderer.invoke(CHANNELS.sendPrompt, ptyId, text),
  pluginBarItems: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.pluginBarItems, key, isPtyId),
  pluginBarRefresh: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.pluginBarRefresh, key, isPtyId),
  pluginRunAction: (item) => ipcRenderer.invoke(CHANNELS.pluginRunAction, item),
  pluginList: () => ipcRenderer.invoke(CHANNELS.pluginList),
  onPluginsChanged: (cb) => subscribe(CHANNELS.pluginsChanged, cb),
  setSessionNote: (id, note) => ipcRenderer.invoke(CHANNELS.setSessionNote, id, note),
  sessionNote: (id) => ipcRenderer.invoke(CHANNELS.sessionNote, id),
  updateStatus: () => ipcRenderer.invoke(CHANNELS.updateStatus),
  updateCheck: () => ipcRenderer.invoke(CHANNELS.updateCheck),
  updateDownload: () => ipcRenderer.invoke(CHANNELS.updateDownload),
  updateInstall: () => ipcRenderer.invoke(CHANNELS.updateInstall),
  updateOpenDownloaded: () => ipcRenderer.invoke(CHANNELS.updateOpenDownloaded),
  updateSkip: () => ipcRenderer.invoke(CHANNELS.updateSkip),
  updateDismiss: () => ipcRenderer.invoke(CHANNELS.updateDismiss),
  onUpdateChanged: (cb) => subscribe(CHANNELS.updateChanged, cb),
}

contextBridge.exposeInMainWorld('apiary', api)
