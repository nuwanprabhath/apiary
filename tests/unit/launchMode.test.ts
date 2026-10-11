import { describe, it, expect } from 'vitest'
import { parseLaunchMode, shouldHoldSingleInstanceLock, shouldOpenFirstWindow, shouldQuitIdleBackground, shouldQuitWhenNoWindows } from '../../src/main/app/launchMode'
import { parseRuntimeEnv } from '../../src/main/app/env'

describe('launch mode', () => {
  it('reads --background from the arguments, packaged or not', () => {
    expect(parseLaunchMode(['apiary', '--background'])).toEqual({ background: true })
    expect(parseLaunchMode(['apiary'])).toEqual({ background: false })
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

  it('a packaged app and a background start hold the single-instance lock; a dev run does not', () => {
    expect(shouldHoldSingleInstanceLock(parseLaunchMode([]), true)).toBe(true)
    expect(shouldHoldSingleInstanceLock(parseLaunchMode(['--background']), false)).toBe(true)
    expect(shouldHoldSingleInstanceLock(parseLaunchMode([]), false)).toBe(false)
  })
})
