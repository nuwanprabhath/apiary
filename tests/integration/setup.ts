import { vi } from 'vitest'
import { tmpdir } from 'node:os'

/**
 * Integration tests build the services through the container (`tests/fixtures/buildService.ts`),
 * and the container module also lists everything that needs Electron (windows, the updater). In
 * plain Node `electron` is just the path to its binary and `electron-updater` throws on import, so
 * both are stubbed for every integration test; a test that cares what they do (ipcWiring, contract)
 * mocks them itself, which replaces these.
 */
vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {}, off: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { fromId: () => null },
  screen: {},
  shell: {},
  ipcMain: {},
  dialog: {},
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: true, autoInstallOnAppQuit: true, logger: null, allowPrerelease: false,
      checkForUpdates: () => {}, downloadUpdate: () => {}, quitAndInstall: () => {},
      on: () => {}, off: () => {},
    },
  },
}))
