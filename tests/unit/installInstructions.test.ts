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

  it('still tells a mac user to drag it into Applications, with no command to run', () => {
    const { hint, command, action } = installInstructions(mac, '/tmp/Apiary-1.13.0-arm64.dmg')
    expect(hint).toContain('Applications')
    expect(command).toBeNull()
    expect(action).toBe('open')
  })
})
