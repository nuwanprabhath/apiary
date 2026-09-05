import { describe, it, expect } from 'vitest'
import { buildTree, filterTree } from '../../src/main/tree/buildTree'
import type { StoredProject, StoredSession } from '../../src/main/store/sessionStore'

const proj = (path: string, over: Partial<StoredProject> = {}): StoredProject => ({
  path, repoRoot: path, isWorktree: false, branch: 'main',
  exists: true, autoImport: false, ...over,
})

const sess = (id: string, projectPath: string, over: Partial<StoredSession> = {}): StoredSession => ({
  sessionId: id, projectPath, title: `Title ${id}`, firstPrompt: null,
  cwd: projectPath, gitBranch: 'main', startedAtMs: 1, lastActiveAtMs: 1,
  messageCount: null, filePath: `/x/${id}.jsonl`, fileMtimeMs: 1, fileSize: 1,
  imported: true, archived: false, ...over,
})

const always = () => true

describe('buildTree', () => {
  it('puts a plain project at the top level with its sessions', () => {
    const tree = buildTree([proj('/p/app')], [sess('s1', '/p/app')], new Set(), always)
    expect(tree).toHaveLength(1)
    expect(tree[0].label).toBe('app')
    expect(tree[0].sessions.map((s) => s.sessionId)).toEqual(['s1'])
    expect(tree[0].children).toHaveLength(0)
  })

  it('nests a worktree under its parent repo', () => {
    const projects = [
      proj('/p/repo'),
      proj('/p/wt', { repoRoot: '/p/repo', isWorktree: true, branch: 'rel/1.0.11' }),
    ]
    const sessions = [sess('s1', '/p/repo'), sess('s2', '/p/wt')]
    const tree = buildTree(projects, sessions, new Set(), always)
    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('/p/repo')
    expect(tree[0].sessions.map((s) => s.sessionId)).toEqual(['s1'])
    expect(tree[0].children).toHaveLength(1)
    const wt = tree[0].children[0] as typeof tree[0]
    expect(wt.branch).toBe('rel/1.0.11')
    expect(wt.sessions.map((s) => s.sessionId)).toEqual(['s2'])
  })

  it('synthesises a parent node when only worktrees have sessions', () => {
    const projects = [proj('/p/wt', { repoRoot: '/p/repo', isWorktree: true, branch: 'dev' })]
    const tree = buildTree(projects, [sess('s1', '/p/wt')], new Set(), always)
    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('/p/repo')
    expect(tree[0].label).toBe('repo')
    expect(tree[0].sessions).toHaveLength(0)
    expect(tree[0].children).toHaveLength(1)
  })

  it('marks live sessions and missing working directories', () => {
    const tree = buildTree(
      [proj('/p/app')],
      [sess('s1', '/p/app'), sess('s2', '/p/app', { cwd: '/p/gone' })],
      new Set(['s1']),
      (path) => path !== '/p/gone',
    )
    const [s1, s2] = tree[0].sessions
    expect(s1.isLive).toBe(true)
    expect(s2.isLive).toBe(false)
    expect(s2.cwdExists).toBe(false)
  })

  it('falls back to the first prompt, then the session id, for a missing title', () => {
    const tree = buildTree(
      [proj('/p/app')],
      [
        sess('s1', '/p/app', { title: null, firstPrompt: 'rename the widget' }),
        sess('s2', '/p/app', { title: null, firstPrompt: null }),
      ],
      new Set(),
      always,
    )
    expect(tree[0].sessions[0].title).toBe('rename the widget')
    expect(tree[0].sessions[1].title).toBe('s2')
  })

  it('sorts sessions newest first', () => {
    const tree = buildTree(
      [proj('/p/app')],
      [sess('old', '/p/app', { lastActiveAtMs: 10 }), sess('new', '/p/app', { lastActiveAtMs: 99 })],
      new Set(),
      always,
    )
    expect(tree[0].sessions.map((s) => s.sessionId)).toEqual(['new', 'old'])
  })
})

describe('filterTree', () => {
  const projects = [
    proj('/p/app'),
    proj('/p/wt', { repoRoot: '/p/repo', isWorktree: true, branch: 'species-list' }),
  ]
  const sessions = [
    sess('s1', '/p/app', { title: 'Fix CSV export' }),
    sess('s2', '/p/app', { title: 'Add worktree switcher' }),
    sess('s3', '/p/wt', { title: 'Bump deps' }),
  ]
  const tree = buildTree(projects, sessions, new Set(), always)

  it('keeps only sessions matching the title', () => {
    const out = filterTree(tree, 'csv')
    expect(out).toHaveLength(1)
    expect(out[0].sessions.map((s) => s.sessionId)).toEqual(['s1'])
  })

  it('keeps a whole project when the project label matches', () => {
    const out = filterTree(tree, 'app')
    expect(out[0].sessions).toHaveLength(2)
  })

  it('keeps a worktree when its branch matches, retaining the parent', () => {
    const out = filterTree(tree, 'species')
    expect(out[0].path).toBe('/p/repo')
    const wt = out[0].children[0] as typeof out[0]
    expect(wt.sessions.map((s) => s.sessionId)).toEqual(['s3'])
  })

  it('returns the whole tree for an empty query', () => {
    expect(filterTree(tree, '')).toEqual(tree)
  })

  it('returns nothing when nothing matches', () => {
    expect(filterTree(tree, 'zzzz')).toHaveLength(0)
  })
})
