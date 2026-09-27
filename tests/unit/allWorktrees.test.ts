import { describe, it, expect } from 'vitest'
import type { ProjectNode } from '@shared/types'
import { withAllWorktrees } from '../../src/renderer/features/sidebar/model/allWorktrees'

function folder(path: string, over: Partial<ProjectNode> = {}): ProjectNode {
  return {
    kind: 'project', path, label: path.split('/').pop() ?? path, branch: null, isWorktree: false,
    children: [], sessions: [], ...over,
  }
}

describe('withAllWorktrees', () => {
  const repo = folder('/r/app', {
    branch: 'main',
    children: [folder('/r/app-b', { isWorktree: true, branch: 'b' })],
  })

  it('adds the worktrees it is given as empty folders, in label order', () => {
    const [out] = withAllWorktrees([repo], new Map([['/r/app', [
      { path: '/r/app-c', branch: 'c' },
      { path: '/r/app-a', branch: null },
    ]]]))
    expect(out.children.map((c) => [c.label, c.branch, c.isWorktree, c.sessions.length])).toEqual([
      ['app-a', null, true, 0],
      ['app-b', 'b', true, 0],
      ['app-c', 'c', true, 0],
    ])
  })

  it('leaves a worktree the tree already shows as it is, rather than listing it twice', () => {
    const [out] = withAllWorktrees([repo], new Map([['/r/app', [{ path: '/r/app-b', branch: 'b' }]]]))
    expect(out).toBe(repo)
  })

  it('touches only the folders it was asked about', () => {
    const other = folder('/r/other')
    const tree = [repo, other]
    const out = withAllWorktrees(tree, new Map([['/r/other', []]]))
    expect(out[0]).toBe(repo)
    expect(out[1]).toBe(other)
    expect(withAllWorktrees(tree, new Map())).toBe(tree)
  })
})
