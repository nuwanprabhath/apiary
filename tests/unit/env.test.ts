import { describe, it, expect } from 'vitest'
import { readTestEnv, parseRuntimeEnv } from '../../src/main/app/env'

describe('readTestEnv', () => {
  it('reads the variable when the app is not packaged', () => {
    expect(readTestEnv('APIARY_CONFIG_ROOT', { APIARY_CONFIG_ROOT: '/tmp/fixture' }, false)).toBe('/tmp/fixture')
  })

  it('ignores the variable in a packaged build, even when set', () => {
    // SEC-3: a packaged app must not honour APIARY_* hooks or ELECTRON_RENDERER_URL — anything
    // that can set a launched process's environment could otherwise redirect the config root or
    // load a remote page with the full preload bridge.
    expect(readTestEnv('APIARY_CONFIG_ROOT', { APIARY_CONFIG_ROOT: '/tmp/fixture' }, true)).toBeUndefined()
    expect(readTestEnv('ELECTRON_RENDERER_URL', { ELECTRON_RENDERER_URL: 'https://evil.example' }, true)).toBeUndefined()
  })

  it('returns undefined when the variable is not set, packaged or not', () => {
    expect(readTestEnv('APIARY_FAKE_UPDATE', {}, false)).toBeUndefined()
    expect(readTestEnv('APIARY_FAKE_UPDATE', {}, true)).toBeUndefined()
  })
})

describe('parseRuntimeEnv', () => {
  it('collects every APIARY_* override and ELECTRON_RENDERER_URL when unpackaged', () => {
    const env = parseRuntimeEnv({
      APIARY_CONFIG_ROOT: '/tmp/config',
      APIARY_DB_PATH: '/tmp/db',
      APIARY_FAKE_LIVE: 'session-1',
      APIARY_CODE_PATH: '/usr/bin/code',
      APIARY_GLAB_PATH: '/usr/bin/glab',
      APIARY_DEFAULT_THEME: 'original',
      APIARY_FAKE_UPDATE: '9.9.9',
      APIARY_FAKE_UPDATE_MODE: 'deb',
      APIARY_HEADLESS: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
    }, [], false)
    expect(env).toEqual({
      configRoot: '/tmp/config',
      dbPath: '/tmp/db',
      fakeLive: 'session-1',
      codePathOverride: '/usr/bin/code',
      glabPath: '/usr/bin/glab',
      defaultThemeOriginal: true,
      safeTheme: false,
      fakeUpdate: '9.9.9',
      fakeUpdateMode: 'deb',
      headless: true,
      rendererUrl: 'http://localhost:5173',
    })
  })

  it('gates every APIARY_* override and the renderer URL on packaging, but not --safe-theme', () => {
    const env = parseRuntimeEnv(
      { APIARY_CONFIG_ROOT: '/tmp/config', ELECTRON_RENDERER_URL: 'https://evil.example', APIARY_SAFE_THEME: '1' },
      ['--safe-theme'],
      true,
    )
    expect(env.configRoot).toBeUndefined()
    expect(env.rendererUrl).toBeUndefined()
    expect(env.safeTheme).toBe(true)
  })

  it('passes the renderer test seams through unpackaged, and never when packaged', () => {
    const seams = JSON.stringify({ petsFlat: true })
    expect(parseRuntimeEnv({ APIARY_RENDERER_SEAMS: seams }, [], false).rendererSeams).toBe(seams)
    expect(parseRuntimeEnv({ APIARY_RENDERER_SEAMS: seams }, [], true).rendererSeams).toBeUndefined()
  })

  it('reads --safe-theme from argv or APIARY_SAFE_THEME from env, packaged or not', () => {
    expect(parseRuntimeEnv({}, ['--safe-theme'], true).safeTheme).toBe(true)
    expect(parseRuntimeEnv({ APIARY_SAFE_THEME: '1' }, [], true).safeTheme).toBe(true)
    expect(parseRuntimeEnv({}, [], true).safeTheme).toBe(false)
  })
})
