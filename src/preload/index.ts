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
  openShell: (id) => ipcRenderer.invoke(CHANNELS.openShell, id),
  openShellForPty: (id) => ipcRenderer.invoke(CHANNELS.openShellForPty, id),
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
}

contextBridge.exposeInMainWorld('apiary', api)
