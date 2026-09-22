import { describe, it, expect } from 'vitest'
import { parseVersion, compareVersions, isNewer, shouldOffer } from '../../src/main/update/versions'
import { decideCapability } from '../../src/main/update/capability'
import { pickInstaller } from '../../src/main/update/installerAsset'

describe('parseVersion', () => {
  it('reads a plain version, with or without the tag prefix', () => {
    expect(parseVersion('1.8.2')).toEqual({ major: 1, minor: 8, patch: 2, prerelease: [] })
    expect(parseVersion('v1.8.2')).toEqual({ major: 1, minor: 8, patch: 2, prerelease: [] })
  })

  it('reads a pre-release, splitting its identifiers and keeping numbers numeric', () => {
    expect(parseVersion('1.9.0-beta.2')?.prerelease).toEqual(['beta', 2])
  })

  it('returns null for something that is not a version, rather than a zero', () => {
    // A feed that answers with something unexpected must not read as "0.0.0", which is older than
    // everything and would offer a downgrade to every user at once.
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('1.8')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions', () => {
  const cmp = (a: string, b: string): number =>
    compareVersions(parseVersion(a)!, parseVersion(b)!)

  it('orders by major, then minor, then patch', () => {
    expect(cmp('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(cmp('1.9.0', '1.8.9')).toBeGreaterThan(0)
    expect(cmp('1.8.3', '1.8.2')).toBeGreaterThan(0)
    expect(cmp('1.8.2', '1.8.2')).toBe(0)
  })

  it('puts a pre-release before the release it leads to', () => {
    expect(cmp('1.9.0-beta.1', '1.9.0')).toBeLessThan(0)
    expect(cmp('1.9.0', '1.9.0-beta.1')).toBeGreaterThan(0)
  })

  it('orders pre-releases among themselves', () => {
    expect(cmp('1.9.0-beta.2', '1.9.0-beta.1')).toBeGreaterThan(0)
    expect(cmp('1.9.0-alpha.1', '1.9.0-beta.1')).toBeLessThan(0)
    // Fewer identifiers sorts first, per semver.
    expect(cmp('1.9.0-beta', '1.9.0-beta.1')).toBeLessThan(0)
  })

  it('is not fooled by numeric identifiers compared as strings', () => {
    // '10' < '9' as text, which is the classic version-sorting bug.
    expect(cmp('1.9.0-beta.10', '1.9.0-beta.9')).toBeGreaterThan(0)
    expect(cmp('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })
})

describe('isNewer', () => {
  it('is false for the same version and for an older one', () => {
    expect(isNewer('1.8.2', '1.8.2')).toBe(false)
    expect(isNewer('1.8.2', '1.8.1')).toBe(false)
  })

  it('is false when either version is unparseable, rather than guessing', () => {
    expect(isNewer('1.8.2', 'nightly')).toBe(false)
    expect(isNewer('unknown', '1.9.0')).toBe(false)
  })
})

describe('shouldOffer', () => {
  const base = { current: '1.8.2', candidate: '1.9.0', skipped: null, allowPrerelease: false }

  it('offers a newer stable release', () => {
    expect(shouldOffer(base)).toBe(true)
  })

  it('never offers a downgrade, which is what a pulled release looks like from here', () => {
    expect(shouldOffer({ ...base, candidate: '1.8.1' })).toBe(false)
  })

  it('hides pre-releases unless they were asked for', () => {
    expect(shouldOffer({ ...base, candidate: '1.9.0-beta.1' })).toBe(false)
    expect(shouldOffer({ ...base, candidate: '1.9.0-beta.1', allowPrerelease: true })).toBe(true)
  })

  it('keeps offering pre-releases to someone already running one', () => {
    // Otherwise a beta tester is stranded on the build they installed, with the app telling them
    // nothing until the next stable release.
    expect(shouldOffer({
      current: '1.9.0-beta.1',
      candidate: '1.9.0-beta.2',
      skipped: null,
      allowPrerelease: false,
    })).toBe(true)
  })

  it('respects a skipped version, but only that exact one', () => {
    expect(shouldOffer({ ...base, skipped: '1.9.0' })).toBe(false)
    expect(shouldOffer({ ...base, candidate: '1.9.1', skipped: '1.9.0' })).toBe(true)
  })

  it('ignores a skip recorded for a version that is no longer newer', () => {
    expect(shouldOffer({ ...base, current: '1.9.0', candidate: '1.9.0', skipped: '1.9.0' })).toBe(false)
  })
})

describe('decideCapability', () => {
  const mac = { platform: 'darwin' as const, packaged: true, appImagePath: undefined, macSigned: false }

  it('will not update anything in a dev run', () => {
    expect(decideCapability({ ...mac, packaged: false }).kind).toBe('unsupported')
  })

  it('an unsigned mac build can only be assisted — Squirrel will not replace it', () => {
    expect(decideCapability(mac).kind).toBe('assisted')
  })

  it('a signed mac build installs by itself', () => {
    expect(decideCapability({ ...mac, macSigned: true }).kind).toBe('auto')
  })

  it('a Linux AppImage installs by itself; a .deb needs the user', () => {
    const linux = { platform: 'linux' as const, packaged: true, macSigned: false }
    expect(decideCapability({ ...linux, appImagePath: '/tmp/Apiary.AppImage' }).kind).toBe('auto')
    expect(decideCapability({ ...linux, appImagePath: undefined }).kind).toBe('assisted')
  })

  it('always says why, so Settings can show a reason rather than a blank', () => {
    for (const input of [mac, { ...mac, packaged: false }, { ...mac, macSigned: true }]) {
      expect(decideCapability(input).reason.length).toBeGreaterThan(0)
    }
  })
})

describe('pickInstaller', () => {
  const file = (url: string) => ({ url, sha512: 'x' })

  it('takes the dmg on macOS, never the zip', () => {
    const files = [file('Apiary-1.9.0-arm64.dmg'), file('Apiary-1.9.0-arm64.zip')]
    expect(pickInstaller(files, 'darwin', 'arm64')?.url).toBe('Apiary-1.9.0-arm64.dmg')
  })

  it('takes the .deb on Linux, not the AppImage sitting beside it in the same release', () => {
    // The real 1.18.1 feed, verbatim file names. Only a .deb install ever downloads an installer
    // on Linux (an AppImage updates itself), and it was being handed the AppImage — which on
    // Ubuntu 22.04+ will not start without libfuse2, and is not what it was installed from.
    const feed = [file('Apiary-1.18.1.AppImage'), file('apiary_1.18.1_amd64.deb')]
    expect(pickInstaller(feed, 'linux', 'x64')?.url).toBe('apiary_1.18.1_amd64.deb')
  })

  it('matches Debian architecture names, and refuses a .deb for another architecture', () => {
    const feed = [file('apiary_1.18.1_amd64.deb'), file('apiary_1.18.1_arm64.deb')]
    expect(pickInstaller(feed, 'linux', 'arm64')?.url).toBe('apiary_1.18.1_arm64.deb')
    expect(pickInstaller([file('apiary_1.18.1_amd64.deb')], 'linux', 'arm64')).toBeNull()
  })

  it('returns null on Linux when the release has no .deb, rather than falling back to the AppImage', () => {
    expect(pickInstaller([file('Apiary-1.18.1.AppImage')], 'linux', 'x64')).toBeNull()
  })

  it('picks the file for this architecture when a release carries several', () => {
    const files = [file('Apiary-1.9.0-arm64.dmg'), file('Apiary-1.9.0-x64.dmg')]
    expect(pickInstaller(files, 'darwin', 'arm64')?.url).toBe('Apiary-1.9.0-arm64.dmg')
    expect(pickInstaller(files, 'darwin', 'x64')?.url).toBe('Apiary-1.9.0-x64.dmg')
  })

  it('treats an unmarked filename as x64, which is how electron-builder names it', () => {
    const files = [file('Apiary-1.9.0.dmg'), file('Apiary-1.9.0-arm64.dmg')]
    expect(pickInstaller(files, 'darwin', 'x64')?.url).toBe('Apiary-1.9.0.dmg')
  })

  it('returns null rather than handing an arm64 build to an Intel Mac', () => {
    expect(pickInstaller([file('Apiary-1.9.0-arm64.dmg')], 'darwin', 'x64')).toBeNull()
    expect(pickInstaller([], 'darwin', 'arm64')).toBeNull()
  })
})
