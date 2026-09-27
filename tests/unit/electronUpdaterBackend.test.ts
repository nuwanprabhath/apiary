import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const openPath = vi.fn<(path: string) => Promise<string>>()
const showItemInFolder = vi.fn<(path: string) => void>()
const checkForUpdates = vi.fn<(...args: unknown[]) => unknown>()
const downloadUpdate = vi.fn<(...args: unknown[]) => unknown>()
const quitAndInstall = vi.fn<(...args: unknown[]) => unknown>()
const httpGet = vi.fn<(url: string, opts: unknown, cb: (r: unknown) => void) => { on: () => void }>()
const execFileMock = vi.fn((_file: string, _args: string[], cb: (e: Error | null, stdout: string, stderr: string) => void) => { cb(null, '', '') })

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
vi.mock('node:https', () => ({ get: (url: string, opts: unknown, cb: (r: unknown) => void) => httpGet(url, opts, cb) }))
vi.mock('node:child_process', () => ({ execFile: (...args: Parameters<typeof execFileMock>) => execFileMock(...args) }))

// Imported after the mocks above so the module picks them up.
const { createUpdateBackend, setQuarantine, OPEN_TIMEOUT_MS } = await import('../../src/main/update/electronUpdaterBackend')

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
    // Linux never sets quarantine — it is a macOS/Gatekeeper concept only.
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('sets com.apple.quarantine on a verified macOS download, so Gatekeeper still evaluates it (SEC-5)', async () => {
    const bytes = Buffer.from('fake dmg bytes')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.18.2', releaseNotes: 'notes', files: [{ url: 'Apiary-1.18.2-arm64.dmg', sha512, size: bytes.length }] },
    })
    httpGet.mockImplementation((_url: string, _opts: unknown, cb: (r: unknown) => void) => {
      cb(fakeResponse(bytes))
      return { on: () => {} }
    })

    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'darwin', arch: 'arm64', downloadDir: dir })
    await backend.check({ allowPrerelease: false })
    const path = await backend.downloadInstaller(() => {})

    expect(execFileMock).toHaveBeenCalledTimes(1)
    const [file, args] = execFileMock.mock.calls[0]
    expect(file).toBe('xattr')
    expect(args).toEqual(['-w', 'com.apple.quarantine', expect.stringMatching(/^0081;[0-9a-f]+;Apiary;$/), path])
  })

  it('does not fail the download when setting quarantine fails', async () => {
    execFileMock.mockImplementationOnce((_file, _args, cb) => { cb(new Error('xattr not found'), '', '') })
    const bytes = Buffer.from('fake dmg bytes')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.18.2', releaseNotes: 'notes', files: [{ url: 'Apiary-1.18.2-arm64.dmg', sha512, size: bytes.length }] },
    })
    httpGet.mockImplementation((_url: string, _opts: unknown, cb: (r: unknown) => void) => {
      cb(fakeResponse(bytes))
      return { on: () => {} }
    })

    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'darwin', arch: 'arm64', downloadDir: dir })
    await backend.check({ allowPrerelease: false })
    const path = await backend.downloadInstaller(() => {})
    expect((await stat(path)).size).toBe(bytes.length)
  })

  it('refuses a feed filename that is not a plain filename (SEC-7)', async () => {
    // A `url` of `..%2F..%2FLibrary%2Fx.dmg` decodes to `../../Library/x.dmg`, which would escape
    // the downloads directory entirely if joined onto it directly.
    const bytes = Buffer.from('fake dmg bytes')
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    checkForUpdates.mockResolvedValue({
      updateInfo: { version: '1.18.2', releaseNotes: 'notes', files: [{ url: '..%2F..%2FLibrary%2Fx.dmg', sha512, size: bytes.length }] },
    })
    // pickInstaller matches on the raw `.dmg` suffix and the arch, both of which this satisfies.
    const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'darwin', arch: 'x64', downloadDir: dir })
    await backend.check({ allowPrerelease: false })
    await expect(backend.downloadInstaller(() => {})).rejects.toThrow(/not a plain filename/)
    expect(httpGet).not.toHaveBeenCalled()
  })
})

describe('setQuarantine', () => {
  it('runs xattr with a quarantine flag naming Apiary', async () => {
    const run = vi.fn(async (_cmd: string, _args: readonly string[]) => ({ stdout: '', stderr: '' }))
    await setQuarantine('/tmp/Apiary-1.0.0.dmg', run)
    expect(run).toHaveBeenCalledWith('xattr', ['-w', 'com.apple.quarantine', expect.stringMatching(/^0081;[0-9a-f]+;Apiary;$/), '/tmp/Apiary-1.0.0.dmg'])
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

  describe('re-checking the hash before opening (SEC-7)', () => {
    let dir: string
    beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'apiary-update-')) })
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); vi.clearAllMocks() })

    it('refuses to open a verified download that changed on disk afterwards', async () => {
      const bytes = Buffer.from('fake deb bytes')
      const sha512 = createHash('sha512').update(bytes).digest('base64')
      checkForUpdates.mockResolvedValue({
        updateInfo: { version: '1.18.2', releaseNotes: 'notes', files: [{ url: 'apiary_1.18.2_amd64.deb', sha512, size: bytes.length }] },
      })
      httpGet.mockImplementation((_url: string, _opts: unknown, cb: (r: unknown) => void) => {
        cb(fakeResponse(bytes))
        return { on: () => {} }
      })
      const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64', downloadDir: dir })
      await backend.check({ allowPrerelease: false })
      const path = await backend.downloadInstaller(() => {})

      // Something replaces the verified file between download and the user clicking Open.
      await writeFile(path, 'tampered bytes')
      const result = await backend.openInstaller(path, 'open')
      expect(result.ok).toBe('failed')
      expect(result.ok === 'failed' && result.reason).toContain('changed since it was verified')
      expect(openPath).not.toHaveBeenCalled()
    })

    it('still opens a verified download that has not changed', async () => {
      const bytes = Buffer.from('fake deb bytes')
      const sha512 = createHash('sha512').update(bytes).digest('base64')
      checkForUpdates.mockResolvedValue({
        updateInfo: { version: '1.18.2', releaseNotes: 'notes', files: [{ url: 'apiary_1.18.2_amd64.deb', sha512, size: bytes.length }] },
      })
      httpGet.mockImplementation((_url: string, _opts: unknown, cb: (r: unknown) => void) => {
        cb(fakeResponse(bytes))
        return { on: () => {} }
      })
      openPath.mockResolvedValue('')
      const backend = createUpdateBackend({ repo: 'nuwan/apiary', platform: 'linux', arch: 'x64', downloadDir: dir })
      await backend.check({ allowPrerelease: false })
      const path = await backend.downloadInstaller(() => {})

      const result = await backend.openInstaller(path, 'open')
      expect(result).toEqual({ ok: 'opened' })
    })
  })
})
