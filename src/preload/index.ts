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
  tree: (query = '') => ipcRenderer.invoke(CHANNELS.tree, query),
  discovered: () => ipcRenderer.invoke(CHANNELS.discovered),
  importSessions: (ids, projects) => ipcRenderer.invoke(CHANNELS.importSessions, ids, projects),
  transcript: (id, beforeIndex) => ipcRenderer.invoke(CHANNELS.transcript, id, beforeIndex),
  checkConflict: (id) => ipcRenderer.invoke(CHANNELS.checkConflict, id),
  resume: (id, fork) => ipcRenderer.invoke(CHANNELS.resume, id, fork),
  renameSession: (id, title) => ipcRenderer.invoke(CHANNELS.renameSession, id, title),
  removeSession: (id) => ipcRenderer.invoke(CHANNELS.removeSession, id),
  openShell: (id, tabId) => ipcRenderer.invoke(CHANNELS.openShell, id, tabId),
  openShellForPty: (id, tabId) => ipcRenderer.invoke(CHANNELS.openShellForPty, id, tabId),
  newSessionInProject: (path) => ipcRenderer.invoke(CHANNELS.newSessionInProject, path),
  onNewSessionStarted: (cb) => subscribe(CHANNELS.newSessionStarted, cb),
  ptyWrite: (id, data) => ipcRenderer.send(CHANNELS.ptyWrite, id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send(CHANNELS.ptyResize, id, cols, rows),
  ptyKill: (id) => ipcRenderer.send(CHANNELS.ptyKill, id),
  onPtyData: (cb) => subscribe(CHANNELS.ptyData, cb),
  onPtyExit: (cb) => subscribe(CHANNELS.ptyExit, cb),
  onTreeChanged: (cb) => subscribe(CHANNELS.treeChanged, cb),
  onOpenImportDialog: (cb) => subscribe(CHANNELS.openImportDialog, cb),
  settingsGet: () => ipcRenderer.invoke(CHANNELS.settingsGet),
  settingsSet: (settings) => ipcRenderer.invoke(CHANNELS.settingsSet, settings),
  onOpenSettingsDialog: (cb) => subscribe(CHANNELS.openSettingsDialog, cb),
  gitStatus: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitStatus, key, isPtyId),
  gitListRefs: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitListRefs, key, isPtyId),
  gitCheckoutBranch: (key, isPtyId, name) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutBranch, key, isPtyId, name),
  gitCheckoutRemote: (key, isPtyId, remoteRef, localName) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutRemote, key, isPtyId, remoteRef, localName),
  gitCheckoutDetached: (key, isPtyId, ref) =>
    ipcRenderer.invoke(CHANNELS.gitCheckoutDetached, key, isPtyId, ref),
  gitCreateBranch: (key, isPtyId, name, from) =>
    ipcRenderer.invoke(CHANNELS.gitCreateBranch, key, isPtyId, name, from),
  gitPull: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitPull, key, isPtyId),
  gitPush: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitPush, key, isPtyId),
  gitMerge: (key, isPtyId, ref) => ipcRenderer.invoke(CHANNELS.gitMerge, key, isPtyId, ref),
  gitFetch: (key, isPtyId) => ipcRenderer.invoke(CHANNELS.gitFetch, key, isPtyId),
  copyToClipboard: (text) => ipcRenderer.invoke(CHANNELS.copyToClipboard, text),
  searchRebuild: () => ipcRenderer.invoke(CHANNELS.searchRebuild),
  searchStatus: () => ipcRenderer.invoke(CHANNELS.searchStatus),
  saveImage: (base64, mediaType) => ipcRenderer.invoke(CHANNELS.saveImage, base64, mediaType),
  readImage: (path) => ipcRenderer.invoke(CHANNELS.readImage, path),
  sendPrompt: (ptyId, text) => ipcRenderer.invoke(CHANNELS.sendPrompt, ptyId, text),
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
