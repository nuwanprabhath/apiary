import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const openPath = vi.fn<(path: string) => Promise<string>>()
const showItemInFolder = vi.fn<(path: string) => void>()
const checkForUpdates = vi.fn()
const downloadUpdate = vi.fn()
const quitAndInstall = vi.fn()
const httpGet = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  shell: { openPath: (p: string) => openPath(p), showItemInFolder: (p: string) => showItemInFolder(p) },
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      get autoDownload() { return true }, set autoDownload(_v: boolean) {},
      set autoInstallOnAppQuit(_v: boolean) {},
      set logger(_v: unknown) {},
      set allowPrerelease(_v: boolean) {},
      checkForUpdates: (...args: unknown[]) => checkForUpdates(...args),
      downloadUpdate: (...args: unknown[]) => downloadUpdate(...args),
      quitAndInstall: (...args: unknown[]) => quitAndInstall(...args),
      on: () => {}, off: () => {},
    },
  },
}))
vi.mock('node:https', () => ({ get: (...args: unknown[]) => httpGet(...args) }))

// Imported after the mocks above so the module picks them up.
const { createUpdateBackend, OPEN_TIMEOUT_MS } = await import('../../src/main/update/electronUpdaterBackend')

/** A response `node:https`'s `get` would hand back: a readable stream plus HTTP's own fields. */
function fakeResponse(body: Buffer, statusCode = 200): PassThrough & { statusCode: number; headers: Record<string, string> } {
  const stream = Object.assign(new PassThrough(), { statusCode, headers: {} })
  process.nextTick(() => stream.end(body))
  return stream
}

describe('downloadInstaller', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apiary-update-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.clearAllMocks() })

  it('downloads the .deb on Linux, not the AppImage published beside it', async () => {
    // Only a .deb installation downloads an installer on Linux. It was being handed the AppImage.
    const bytes = Buffer.from('fake deb bytes')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    checkForUpdates.mockResolvedValue({
      updateInfo: {
        version: '1.18.2',
        releaseNotes: 'notes',
        files: [
          { url: 'Apiary-1.18.2.AppImage', sha512: 'not-this-one', size: 999 },
          { url: 'apiary_1.18.2_amd64.deb', sha512, size: bytes.length },
        ],
      },
    })
    const requested: string[] = []
    httpGet.mockImplementation((url: string, _opts: unknown, cb: (r: unknown) => void) => {
      requested.push(url)
      cb(fakeResponse(bytes))
      return { on: () => {} }
    })

    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64', downloadDir: dir })
    await backend.check({ allowPrerelease: false })
    const path = await backend.downloadInstaller(() => {})

    expect(path).toBe(join(dir, 'apiary_1.18.2_amd64.deb'))
    expect(requested).toEqual(['https://github.com/nuwan/apiary/releases/download/v1.18.2/apiary_1.18.2_amd64.deb'])
    expect((await stat(path)).size).toBe(bytes.length)
  })
})

describe('openInstaller', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('reports "opened" when the OS launches it before the timeout', async () => {
    openPath.mockResolvedValue('')
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'darwin', arch: 'arm64' })
    const result = await backend.openInstaller('/tmp/Apiary-1.18.0.dmg', 'open')
    expect(result).toEqual({ ok: 'opened' })
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('reports "revealed", not success, when the OS never comes back before the timeout', async () => {
    vi.useFakeTimers()
    openPath.mockReturnValue(new Promise(() => {})) // never resolves — the bug this exists for.
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64' })
    const pending = backend.openInstaller('/home/nuwan/Downloads/apiary.deb', 'open')
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS)
    const result = await pending
    expect(result).toEqual({ ok: 'revealed' })
    expect(showItemInFolder).toHaveBeenCalledWith('/home/nuwan/Downloads/apiary.deb')
    vi.useRealTimers()
  })

  it('reveals rather than opens when the action is "reveal", and reports it', async () => {
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64' })
    const result = await backend.openInstaller('/home/nuwan/Downloads/apiary.deb', 'reveal')
    expect(result).toEqual({ ok: 'revealed' })
    expect(openPath).not.toHaveBeenCalled()
  })

  it('reports "failed" with a reason when even revealing it throws', async () => {
    showItemInFolder.mockImplementation(() => { throw new Error('no file manager registered') })
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64' })
    const result = await backend.openInstaller('/home/nuwan/Downloads/apiary.deb', 'reveal')
    expect(result).toEqual({ ok: 'failed', reason: 'no file manager registered' })
  })
})
