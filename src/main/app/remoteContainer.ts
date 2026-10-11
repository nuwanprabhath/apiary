import { BrowserWindow, webContents } from 'electron'
import { IPC } from '@shared/api'
import type { RemoteStatus } from '@shared/domain/remote'
import { createExec } from '../exec/run'
import { HostDirectory } from '../remote/hostDirectory'
import { PairingStore } from '../remote/pairingStore'
import { makePrivateDir, pathExists, readSshConfigFile, removePrivateDir } from '../remote/privateDir'
import { RemoteClientService } from '../remote/remoteClientService'
import { RemoteConnection } from '../remote/remoteConnection'
import { RemoteServer } from '../remote/remoteServer'
import { RemoteWindows } from '../remote/remoteWindows'
import { safeStorageCipher } from '../remote/safeStorageCipher'
import { SavedPairingCodes } from '../remote/savedPairingCodes'
import { sshExec, startSshTunnel } from '../remote/sshTunnel'
import { VirtualContentsRegistry } from '../remote/virtualContents'
import { createVsCodeBridge } from '../remote/vscodeBridge'
import type { VsCodeService } from '../vscode/vscodeService'
import type { WindowManager } from '../windows/windowManager'
import type { WindowLayoutRecord } from '../windows/sessionLayoutStore'
import { broadcast } from '../windows/broadcast'
import { sendEvent } from '../windows/sendEvent'

/**
 * Remote access's part of the composition root (docs/proposals/2026-10-10-remote-access.md), split
 * out of `container.ts` when it outgrew one file. The `construct-in-container` rule allows exactly
 * these two files to build long-lived objects.
 *
 * Two phases, because the session services sit between them. The work machine's side (the server
 * and the windows it serves) is built before the services, whose status-bar item lists the server's
 * clients. The home machine's side (the router, the host list, the client) is built after, because
 * opening a remote file in VS Code needs the services' resolver.
 */

interface RemoteSettings {
  get(): { remoteAccessPairing: boolean }
  patch(change: { remoteAccess: boolean }): unknown
}

export interface ServingInputs {
  homeDir: string
  host: string
  appVersion: string
  pairingFile: string
  settings: RemoteSettings
  layouts: () => readonly WindowLayoutRecord[]
}

/** The work machine's side: what other machines connect to. */
export function createRemoteServing(inputs: ServingInputs): {
  virtualContents: VirtualContentsRegistry
  remotePairing: PairingStore
  remoteServer: RemoteServer
  /** The session services' VS Code resolver, once they exist (the server answers `resolve` with it). */
  useVsCode: (vscode: Pick<VsCodeService, 'resolveFolder' | 'resolveMentionedFile'>) => void
} {
  const virtualContents = new VirtualContentsRegistry()
  const remotePairing = new PairingStore(inputs.pairingFile, () => inputs.settings.get().remoteAccessPairing)
  let vscode: Pick<VsCodeService, 'resolveFolder' | 'resolveMentionedFile'> | null = null
  const notReady = (): never => { throw new Error('Not ready yet.') }
  const remoteServer = new RemoteServer({
    homeDir: inputs.homeDir, host: inputs.host, appVersion: inputs.appVersion,
    registry: virtualContents, layouts: inputs.layouts, pairing: remotePairing,
    // Home machines reconnect by themselves, so "Disconnect all" also stops new connections.
    turnOff: () => { inputs.settings.patch({ remoteAccess: false }) },
    vscode: {
      resolveFolder: (terminal) => (vscode ?? notReady()).resolveFolder(terminal),
      resolveMentionedFile: (terminal, mention) => (vscode ?? notReady()).resolveMentionedFile(terminal, mention),
    },
  })
  remoteServer.subscribe((clients) => { broadcast(IPC.remoteClientsChanged, clients) })
  return { virtualContents, remotePairing, remoteServer, useVsCode: (v) => { vscode = v } }
}

export interface ConnectingInputs {
  homeDir: string
  host: string
  appVersion: string
  vsCodePath: string | null
  sshConfig: string | undefined
  hostsFile: string
  pairingCodesFile: string
  windowManager: Pick<WindowManager, 'open'>
}

/** The home machine's side: connecting to other machines and showing their windows here. */
export function createRemoteConnecting(inputs: ConnectingInputs): {
  remoteWindows: RemoteWindows
  hostDirectory: HostDirectory
  remoteClient: RemoteClientService
} {
  const remoteWindows = new RemoteWindows((id) => webContents.fromId(id) ?? null, createVsCodeBridge({ vsCodePath: () => inputs.vsCodePath }))
  const hostDirectory = new HostDirectory({
    file: inputs.hostsFile, homeDir: inputs.homeDir, readText: readSshConfigFile, sshConfig: inputs.sshConfig,
    exec: createExec({ timeoutMs: 3000, scope: 'remote' }), probeExec: sshExec(6000), now: () => Date.now(),
  })
  hostDirectory.subscribe((hosts) => { broadcast(IPC.remoteHostsChanged, hosts) })
  const remoteClient = new RemoteClientService({
    appVersion: inputs.appVersion, sshConfig: inputs.sshConfig, exec: sshExec(20_000), startTunnel: startSshTunnel,
    connect: (path, options) => RemoteConnection.connect(path, { ...options, client: inputs.host }),
    pairingCodes: new SavedPairingCodes(inputs.pairingCodesFile, safeStorageCipher()),
    makeTempDir: makePrivateDir, removeDir: removePrivateDir, socketExists: pathExists,
    openWindow: (host, layout) => inputs.windowManager.open({ remote: { host, layout } }),
    focusWindow: (id) => { BrowserWindow.getAllWindows().find((w) => w.webContents.id === id)?.focus() },
    windows: remoteWindows,
    sendStatus: (id, status: RemoteStatus) => { sendEvent(webContents.fromId(id), IPC.remoteStatus, status) },
    onConnected: (host) => { hostDirectory.connected(host) },
    probe: (host) => hostDirectory.probeNow(host),
  })
  return { remoteWindows, hostDirectory, remoteClient }
}
