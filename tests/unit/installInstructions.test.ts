import { describe, it, expect } from 'vitest'
import { installInstructions } from '../../src/main/update/capability'

const linux = { platform: 'linux' as const, packaged: true, appImagePath: undefined, macSigned: false }
const mac = { platform: 'darwin' as const, packaged: true, appImagePath: undefined, macSigned: false }

describe('installInstructions', () => {
  it('does not ask a Linux user to drag Apiary into Applications', () => {
    // The bug this is here for: the banner said exactly that on Ubuntu, next to a button that
    // could not open a .deb.
    const { hint } = installInstructions(linux, '/home/nuwan/Downloads/apiary_1.13.0_amd64.deb')
    expect(hint).not.toContain('Applications')
    expect(hint).toContain('root')
  })

  it('gives a .deb the command that actually installs it', () => {
    const { command, action } = installInstructions(linux, '/home/nuwan/Downloads/apiary_1.13.0_amd64.deb')
    expect(command).toBe("sudo apt install '/home/nuwan/Downloads/apiary_1.13.0_amd64.deb'")
    // Revealing it, not handing it to the OS: `shell.openPath` on a .deb reports success and does
    // nothing at all on a stock Ubuntu desktop, which is why the button looked dead.
    expect(action).toBe('reveal')
  })

  it('quotes the path, so a download folder with a space in it still pastes', () => {
    const { command } = installInstructions(linux, '/home/a b/apiary_1.13.0_amd64.deb')
    expect(command).toBe("sudo apt install '/home/a b/apiary_1.13.0_amd64.deb'")
  })

  it('leaves a Linux AppImage download to be opened, since only .deb is the special case', () => {
    expect(installInstructions(linux, '/tmp/Apiary-1.13.0.AppImage').action).toBe('open')
  })

  it('gives an AppImage the command that makes it executable and runs it', () => {
    const { command, action } = installInstructions(linux, '/tmp/Apiary-1.13.0.AppImage')
    expect(command).toBe("chmod +x '/tmp/Apiary-1.13.0.AppImage' && '/tmp/Apiary-1.13.0.AppImage'")
    expect(action).toBe('open')
  })

  it('quotes an AppImage path with a space and one with an apostrophe', () => {
    expect(installInstructions(linux, '/home/a b/Apiary-1.13.0.AppImage').command)
      .toBe("chmod +x '/home/a b/Apiary-1.13.0.AppImage' && '/home/a b/Apiary-1.13.0.AppImage'")
    expect(installInstructions(linux, "/home/o'brien/Apiary-1.13.0.AppImage").command)
      .toBe("chmod +x '/home/o'\\''brien/Apiary-1.13.0.AppImage' && '/home/o'\\''brien/Apiary-1.13.0.AppImage'")
  })

  it('gives a mac .dmg a one-line command that mounts, copies and detaches it', () => {
    const { command, action } = installInstructions(mac, '/tmp/Apiary-1.13.0-arm64.dmg')
    expect(command).toContain('hdiutil attach')
    expect(command).toContain('/Applications')
    expect(command).toContain('hdiutil detach')
    expect(action).toBe('open')
  })

  it('quotes a .dmg path with a space and one with an apostrophe', () => {
    expect(installInstructions(mac, '/Users/a b/Apiary-1.13.0.dmg').command).toContain("'/Users/a b/Apiary-1.13.0.dmg'")
    expect(installInstructions(mac, "/Users/o'brien/Apiary-1.13.0.dmg").command)
      .toContain("'/Users/o'\\''brien/Apiary-1.13.0.dmg'")
  })

  it('still tells a mac user to drag it into Applications, and gives the command that does it', () => {
    const { hint, command, action } = installInstructions(mac, '/tmp/Apiary-1.13.0-arm64.dmg')
    expect(hint).toContain('Applications')
    expect(command).not.toBeNull()
    expect(action).toBe('open')
  })
})
