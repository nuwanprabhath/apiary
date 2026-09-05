import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractMeta, scanProjects } from '../../src/main/scanner/sessionScanner'
import { makeSession } from '../fixtures/makeSession'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apiary-projects-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('extractMeta', () => {
  it('reads cwd, branch, title and first prompt', async () => {
    const file = makeSession(root, '-home-nuwan-app', {
      sessionId: '11111111-1111-1111-1111-111111111111',
      cwd: '/home/nuwan/app',
      gitBranch: 'dev/1.0.12',
      title: 'Fix CSV export bug',
      firstPrompt: 'the export is empty',
    })
    const meta = await extractMeta(file)
    expect(meta.sessionId).toBe('11111111-1111-1111-1111-111111111111')
    expect(meta.cwd).toBe('/home/nuwan/app')
    expect(meta.gitBranch).toBe('dev/1.0.12')
    expect(meta.title).toBe('Fix CSV export bug')
    expect(meta.firstPrompt).toBe('the export is empty')
    expect(meta.messageCount).toBeNull()
  })

  it('NEVER derives cwd from the lossy directory slug', async () => {
    // Both "/" and "." collapse to "-", so the slug is not invertible.
    const slug = '-Users-nuwan-projects-paratoo-fdcp-worktrees-1-0-11'
    const realCwd = '/Users/nuwan/projects/paratoo-fdcp.worktrees/1.0.11'
    const file = makeSession(root, slug, {
      sessionId: '22222222-2222-2222-2222-222222222222',
      cwd: realCwd,
      title: 'Species list sync',
    })
    const meta = await extractMeta(file)
    expect(meta.cwd).toBe(realCwd)
    expect(meta.cwd).not.toBe('/Users/nuwan/projects/paratoo-fdcp/worktrees/1.0.11')
  })

  it('finds the title when it sits beyond the head chunk', async () => {
    const file = makeSession(root, '-home-nuwan-big', {
      sessionId: '33333333-3333-3333-3333-333333333333',
      cwd: '/home/nuwan/big',
      title: 'Late title',
      padTurns: 800, // ~160KB of padding, well past the 64KB head chunk
    })
    const meta = await extractMeta(file)
    expect(meta.title).toBe('Late title')
  })

  it('falls back to the first prompt when there is no ai-title', async () => {
    const file = makeSession(root, '-home-nuwan-untitled', {
      sessionId: '44444444-4444-4444-4444-444444444444',
      cwd: '/home/nuwan/untitled',
      firstPrompt: 'rename the widget',
    })
    const meta = await extractMeta(file)
    expect(meta.title).toBeNull()
    expect(meta.firstPrompt).toBe('rename the widget')
  })

  it('skips corrupt lines instead of throwing', async () => {
    const file = makeSession(root, '-home-nuwan-corrupt', {
      sessionId: '55555555-5555-5555-5555-555555555555',
      cwd: '/home/nuwan/corrupt',
      title: 'Still readable',
      extraLines: ['{not json', ''],
    })
    const meta = await extractMeta(file)
    expect(meta.title).toBe('Still readable')
    expect(meta.cwd).toBe('/home/nuwan/corrupt')
  })

  it('returns null fields for a file with no usable entries', async () => {
    const dir = join(root, '-home-nuwan-empty')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, '66666666-6666-6666-6666-666666666666.jsonl')
    writeFileSync(file, JSON.stringify({ type: 'queue-operation' }) + '\n')
    const meta = await extractMeta(file)
    expect(meta.cwd).toBeNull()
    expect(meta.title).toBeNull()
    expect(meta.sessionId).toBe('66666666-6666-6666-6666-666666666666')
  })

  it('records file size and mtime for cache invalidation', async () => {
    const file = makeSession(root, '-home-nuwan-app', {
      sessionId: '77777777-7777-7777-7777-777777777777',
      cwd: '/home/nuwan/app',
    })
    const meta = await extractMeta(file)
    expect(meta.fileSize).toBeGreaterThan(0)
    expect(meta.fileMtimeMs).toBeGreaterThan(0)
  })
})

describe('scanProjects', () => {
  it('finds every jsonl across every project directory', async () => {
    makeSession(root, '-home-nuwan-a', { sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', cwd: '/home/nuwan/a' })
    makeSession(root, '-home-nuwan-a', { sessionId: 'aaaaaaaa-0000-0000-0000-000000000002', cwd: '/home/nuwan/a' })
    makeSession(root, '-home-nuwan-b', { sessionId: 'bbbbbbbb-0000-0000-0000-000000000001', cwd: '/home/nuwan/b' })
    const all = await scanProjects(root)
    expect(all).toHaveLength(3)
    expect(new Set(all.map((m) => m.cwd))).toEqual(new Set(['/home/nuwan/a', '/home/nuwan/b']))
  })

  it('ignores non-jsonl files and returns empty when the root is missing', async () => {
    mkdirSync(join(root, '-home-nuwan-c'), { recursive: true })
    writeFileSync(join(root, '-home-nuwan-c', 'notes.md'), 'hello')
    expect(await scanProjects(root)).toHaveLength(0)
    expect(await scanProjects(join(root, 'does-not-exist'))).toHaveLength(0)
  })
})
