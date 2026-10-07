import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatStartMode } from '../../src/main/chat/startMode'

/** The permission mode a chat starts in when the composer has not picked one. */
describe('chatStartMode', () => {
  let root: string
  let configRoot: string
  let cwd: string
  const write = (file: string, content: string): void => {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  const mode = (defaultMode: string): string => JSON.stringify({ permissions: { defaultMode } })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'apiary-startmode-'))
    configRoot = join(root, 'config')
    cwd = join(root, 'project')
    mkdirSync(cwd, { recursive: true })
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('is Auto when no Claude settings choose a mode', () => {
    expect(chatStartMode(configRoot, cwd)).toBe('auto')
    write(join(configRoot, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }))
    write(join(cwd, '.claude', 'settings.json'), '{ not json')
    expect(chatStartMode(configRoot, cwd)).toBe('auto')
  })

  it.each([
    ['the user settings', (c: string, _p: string) => join(c, 'settings.json')],
    ['the project settings', (_c: string, p: string) => join(p, '.claude', 'settings.json')],
    ['the local project settings', (_c: string, p: string) => join(p, '.claude', 'settings.local.json')],
  ])('leaves it to claude when %s choose one', (_name, fileOf) => {
    write(fileOf(configRoot, cwd), mode('plan'))
    expect(chatStartMode(configRoot, cwd)).toBeUndefined()
  })
})
