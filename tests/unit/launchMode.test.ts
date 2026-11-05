import { describe, it, expect } from 'vitest'
import { desktopProfile, needsNoDisplay, parseLaunchMode, shouldJoinBackground, shouldHoldSingleInstanceLock, shouldOpenFirstWindow, shouldQuitIdleBackground, shouldQuitWhenNoWindows } from '../../src/main/app/launchMode'
import { parseRuntimeEnv } from '../../src/main/app/env'

describe('launch mode', () => {
  it('reads --background from the arguments, packaged or not', () => {
    expect(parseLaunchMode(['apiary', '--background'])).toEqual({ background: true, update: false, service: null })
    expect(parseLaunchMode(['apiary'])).toEqual({ background: false, update: false, service: null })
    expect(parseRuntimeEnv({}, ['--background'], true).background).toBe(true)
  })

  it('with --background opens no first window and stays alive with none, on every platform', () => {
    const mode = parseLaunchMode(['--background'])
    expect(shouldOpenFirstWindow(mode, false)).toBe(false)
    for (const platform of ['darwin', 'linux', 'win32'] as const) expect(shouldQuitWhenNoWindows(mode, platform)).toBe(false)
  })

  it('a second, normal launch opens a window', () => {
    expect(shouldOpenFirstWindow(parseLaunchMode(['--background']), true)).toBe(true)
  })

  it('without the flag nothing changes: a window opens, and the last one closing quits except on macOS', () => {
    const mode = parseLaunchMode([])
    expect(shouldOpenFirstWindow(mode, false)).toBe(true)
    expect(shouldQuitWhenNoWindows(mode, 'linux')).toBe(true)
    expect(shouldQuitWhenNoWindows(mode, 'win32')).toBe(true)
    expect(shouldQuitWhenNoWindows(mode, 'darwin')).toBe(false)
  })

  it('a background app quits when remote access is off and no window is open, and only then', () => {
    const background = parseLaunchMode(['--background'])
    expect(shouldQuitIdleBackground(background, false, 0)).toBe(true)
    expect(shouldQuitIdleBackground(background, true, 0)).toBe(false)
    // A second, normal launch opened a window: the person is using it.
    expect(shouldQuitIdleBackground(background, false, 1)).toBe(false)
    expect(shouldQuitIdleBackground(parseLaunchMode([]), false, 0)).toBe(false)
  })

  it('a background app whose server was refused quits with no window, but a normal app or one with a window stays', () => {
    const background = parseLaunchMode(['--background'])
    expect(shouldQuitIdleBackground(background, true, 0, true)).toBe(true)
    expect(shouldQuitIdleBackground(background, true, 1, true)).toBe(false)
    expect(shouldQuitIdleBackground(parseLaunchMode([]), true, 0, true)).toBe(false)
  })

  it('starts Chromium with no display only for a background start on Linux with no DISPLAY or WAYLAND_DISPLAY', () => {
    const bg = { background: true, update: false, service: null }
    expect(needsNoDisplay(bg, 'linux', {})).toBe(true)
    expect(needsNoDisplay(bg, 'linux', { DISPLAY: ' ' })).toBe(true)
    expect(needsNoDisplay(bg, 'linux', { DISPLAY: ':0' })).toBe(false)
    expect(needsNoDisplay(bg, 'linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe(false)
    expect(needsNoDisplay(bg, 'darwin', {})).toBe(false)
    // A normal launch with no display is left to fail as it always has: it is meant to show a window.
    expect(needsNoDisplay({ background: false, update: false, service: null }, 'linux', {})).toBe(false)
  })

  it('the command-line update holds no lock, and starts Chromium with no display when there is none', () => {
    const update = parseLaunchMode(['apiary', '--update'])
    expect(update).toEqual({ background: false, update: true, service: null })
    expect(shouldHoldSingleInstanceLock(update, true)).toBe(false)
    expect(shouldHoldSingleInstanceLock({ background: true, update: true, service: null }, true)).toBe(false)
    expect(needsNoDisplay(update, 'linux', {})).toBe(true)
    expect(needsNoDisplay(update, 'linux', { DISPLAY: ':0' })).toBe(false)
  })

  it('a desktop launch joins the running Apiary only when that one has no display and this one has', () => {
    const normal = { background: false, update: false, service: null }
    const headless = ['--background', '--ozone-platform=headless']
    expect(shouldJoinBackground(normal, 'linux', { DISPLAY: ':0' }, headless)).toBe(true)
    expect(shouldJoinBackground(normal, 'linux', { WAYLAND_DISPLAY: 'wayland-0' }, headless)).toBe(true)
    // One that has a display opens the window itself, as a second launch always made it do.
    expect(shouldJoinBackground(normal, 'linux', { DISPLAY: ':0' }, ['--background'])).toBe(false)
    expect(shouldJoinBackground(normal, 'linux', { DISPLAY: ':0' }, null)).toBe(false)
    expect(shouldJoinBackground(normal, 'linux', {}, headless)).toBe(false)
    expect(shouldJoinBackground({ background: true, update: false, service: null }, 'linux', { DISPLAY: ':0' }, headless)).toBe(false)
    expect(shouldJoinBackground({ background: false, update: true, service: null }, 'linux', { DISPLAY: ':0' }, headless)).toBe(false)
    expect(shouldJoinBackground(normal, 'darwin', { DISPLAY: ':0' }, headless)).toBe(false)
    expect(desktopProfile('/home/me/.config/apiary')).toBe('/home/me/.config/apiary-desktop')
  })

  it('reads the service commands, which are terminal commands like the update: no lock, no display needed', () => {
    const install = parseLaunchMode(['apiary', '--install-service'])
    expect(install.service).toBe('install')
    expect(parseLaunchMode(['apiary', '--uninstall-service']).service).toBe('uninstall')
    expect(shouldHoldSingleInstanceLock(install, true)).toBe(false)
    expect(needsNoDisplay(install, 'linux', {})).toBe(true)
  })

  it('a packaged app and a background start hold the single-instance lock; a dev run does not', () => {
    expect(shouldHoldSingleInstanceLock(parseLaunchMode([]), true)).toBe(true)
    expect(shouldHoldSingleInstanceLock(parseLaunchMode(['--background']), false)).toBe(true)
    expect(shouldHoldSingleInstanceLock(parseLaunchMode([]), false)).toBe(false)
  })
})
