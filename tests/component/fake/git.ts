/**
 * Git and worktrees in the fake, modelled on main's `GitService` and `BranchOps`: a repository is a
 * project and the projects that name it as `parent` are its worktrees; a branch can be current in
 * one checkout at a time; a branch with an upstream is ahead and behind it, and what a teammate
 * pushed is only known after a fetch. The contract (`tests/contract/clauses/git.ts`) pins it.
 */
import type { GitRefEntry } from '@shared/types'
import type { ApiaryApi } from '@shared/api'
import { worktreeNameProblem, type FolderWorktree, type GitTarget } from '@shared/domain/git'
import type { Env, FakeProject } from './state'

export const fakeRef = (name: string): GitRefEntry => ({ name, relativeDate: '2 days ago', author: 'Test', shortSha: 'abc1234', subject: `tip of ${name}` })

type GitApi = Pick<ApiaryApi,
  | 'gitStatus' | 'gitListRefs' | 'gitlabMrRefStatus' | 'gitCheckoutBranch' | 'gitCheckoutBranchMovingOther' | 'gitPullWorktree'
  | 'newSessionInWorktree' | 'gitCheckoutRemote' | 'gitCheckoutDetached' | 'gitCreateBranch' | 'gitPull' | 'gitUpdateBranch'
  | 'gitPullFolder' | 'listWorktrees' | 'worktreeCreateOptions' | 'worktreeCreate' | 'gitPush' | 'gitMerge' | 'gitFetch'>

interface Checkout { path: string; branch: string | null; project?: FakeProject }

const nameOf = (path: string): string => path.split('/').pop() ?? path

export function gitApi(env: Env): GitApi {
  const { state, emit } = env

  const currentOf = (p: FakeProject): string | null => (p.detached === true ? null : p.isWorktree === true ? p.branch : state.refs.current)
  const rootOf = (p: FakeProject): string => p.parent ?? p.path
  /** Every checkout of the repository `p` belongs to: the main one, its worktrees, and any created since. */
  const checkouts = (p: FakeProject): Checkout[] => {
    const root = rootOf(p)
    const known = state.projects
      .filter((x) => x.path === root || x.parent === root)
      .map((x): Checkout => ({ path: x.path, branch: currentOf(x), project: x }))
    const more = (state.worktrees[root] ?? [])
      .filter((w) => !known.some((k) => k.path === w.path))
      .map((w): Checkout => ({ path: w.path, branch: w.branch }))
    return [...known, ...more]
  }
  const holderOf = (p: FakeProject, branch: string): Checkout | undefined =>
    checkouts(p).find((c) => c.path !== p.path && c.branch === branch)

  const project = (target: GitTarget): FakeProject => {
    const p = env.projectOf(target)
    if (p === undefined) throw new Error('This folder is not known.')
    return p
  }
  const repo = (target: GitTarget): FakeProject => {
    const p = project(target)
    if (p.notRepo === true) throw new Error('fatal: not a git repository')
    return p
  }
  const known = (path: string): FakeProject => {
    const p = state.projects.find((x) => x.path === path)
    if (p === undefined) throw new Error('This folder is not known.')
    return p
  }
  const refExists = (ref: string): boolean =>
    [...state.refs.local, ...state.refs.remote, ...state.refs.tags].some((r) => r.name === ref)

  const setBranch = (p: FakeProject, name: string | null): void => {
    p.detached = name === null
    if (p.isWorktree === true) p.branch = name
    else {
      state.refs = { ...state.refs, current: name }
      if (p.tracked === true) p.branch = name
    }
  }
  const addLocal = (name: string): void => {
    if (!state.refs.local.some((r) => r.name === name)) state.refs = { ...state.refs, local: [...state.refs.local, fakeRef(name)] }
  }
  const upstreamOf = (branch: string | null): NonNullable<ReturnType<typeof state.tracking.get>> => {
    const t = branch === null ? undefined : state.tracking.get(branch)
    if (t?.upstream !== true) throw new Error('There is no tracking information for the current branch.')
    return t
  }
  /** Brings a branch level with its upstream; how many commits that was. */
  const catchUp = (t: { behind: number; pending: number }): number => {
    const commits = t.pending + t.behind
    t.pending = 0
    t.behind = 0
    return commits
  }
  const otherCheckouts = (p: FakeProject): FolderWorktree[] =>
    checkouts(p).filter((c) => c.path !== p.path).map((c) => ({ path: c.path, branch: c.branch }))

  const options = (p: FakeProject): { parentDir: string; existingNames: string[]; local: string[]; remote: string[]; checkedOut: string[] } => {
    const parentDir = `${rootOf(p)}.worktrees`
    return {
      parentDir,
      existingNames: (state.worktrees[rootOf(p)] ?? []).filter((w) => w.path.startsWith(`${parentDir}/`)).map((w) => nameOf(w.path)),
      local: state.refs.local.map((r) => r.name),
      remote: state.refs.remote.map((r) => r.name).filter((n) => !n.endsWith('/HEAD')),
      checkedOut: [...new Set(checkouts(p).map((c) => c.branch).filter((b): b is string => b !== null))],
    }
  }

  return {
    gitStatus: async (target) => {
      const p = project(target)
      if (p.notRepo === true) return null
      const branch = currentOf(p)
      const t = branch === null ? undefined : state.tracking.get(branch)
      return { branch, ahead: t?.ahead ?? 0, behind: t?.behind ?? 0, hasUpstream: t?.upstream ?? false }
    },
    gitListRefs: async (target) => ({ ...state.refs, current: currentOf(repo(target)) }),
    // No GitLab remote in the fixture: every reference stays unresolved, as in main.
    gitlabMrRefStatus: async (target, iids) => { project(target); return Object.fromEntries(iids.map((iid) => [iid, null])) },

    gitCheckoutBranch: async (target, name) => {
      const p = repo(target)
      if (!state.refs.local.some((r) => r.name === name)) throw new Error(`error: pathspec '${name}' did not match any file(s) known to git`)
      if (currentOf(p) === name) return { ok: true }
      const holder = holderOf(p, name)
      if (holder !== undefined) {
        const taken = new Set(checkouts(p).map((c) => c.branch))
        const free = state.refs.local.map((r) => r.name).filter((n) => !taken.has(n))
        const current = currentOf(p)
        return {
          ok: false,
          conflict: { branch: name, worktreePath: holder.path, label: nameOf(holder.path), current, choices: current === null ? free : [current, ...free] },
        }
      }
      setBranch(p, name)
      emit('treeChanged')
      return { ok: true }
    },
    gitCheckoutBranchMovingOther: async (target, branch, otherTo) => {
      const p = repo(target)
      const other = holderOf(p, branch)
      if (other === undefined) throw new Error(`${branch} is no longer checked out in a worktree of this repository`)
      if (!state.refs.local.some((r) => r.name === otherTo)) throw new Error(`invalid reference: ${otherTo}`)
      if (currentOf(p) !== otherTo && checkouts(p).some((c) => c.branch === otherTo)) throw new Error(`'${otherTo}' is already used by another worktree`)
      if (other.project !== undefined) setBranch(other.project, otherTo)
      else {
        const root = rootOf(p)
        state.worktrees[root] = (state.worktrees[root] ?? []).map((w) => (w.path === other.path ? { ...w, branch: otherTo } : w))
      }
      setBranch(p, branch)
      emit('treeChanged')
    },
    gitCreateBranch: async (target, name, from) => {
      const p = repo(target)
      if (state.refs.local.some((r) => r.name === name)) throw new Error(`fatal: a branch named '${name}' already exists`)
      if (from !== undefined && !refExists(from)) throw new Error(`fatal: '${from}' is not a commit`)
      addLocal(name)
      setBranch(p, name)
      emit('treeChanged')
    },
    gitCheckoutRemote: async (target, remoteRef, localName) => {
      const p = repo(target)
      if (!state.refs.remote.some((r) => r.name === remoteRef)) throw new Error(`fatal: '${remoteRef}' is not a commit`)
      if (state.refs.local.some((r) => r.name === localName)) throw new Error(`fatal: a branch named '${localName}' already exists`)
      addLocal(localName)
      state.tracking.set(localName, { upstream: true, ahead: 0, behind: 0, pending: 0 })
      setBranch(p, localName)
      emit('treeChanged')
    },
    gitCheckoutDetached: async (target, ref) => {
      const p = repo(target)
      if (ref !== 'HEAD' && !refExists(ref)) throw new Error(`fatal: invalid reference: ${ref}`)
      setBranch(p, null)
      emit('treeChanged')
    },
    gitMerge: async (target, ref) => {
      repo(target)
      if (!refExists(ref)) throw new Error(`merge: ${ref} - not something we can merge`)
      emit('treeChanged')
    },

    gitFetch: async (target) => {
      repo(target)
      for (const t of state.tracking.values()) { t.behind += t.pending; t.pending = 0 }
      emit('treeChanged')
    },
    gitPull: async (target) => {
      const p = repo(target)
      return { commits: catchUp(upstreamOf(currentOf(p))) }
    },
    gitPush: async (target) => {
      const p = repo(target)
      const branch = currentOf(p)
      if (branch === null) throw new Error('fatal: You are not currently on a branch.')
      const t = state.tracking.get(branch)
      if (t?.upstream === true) {
        const commits = t.ahead
        t.ahead = 0
        return { commits, published: false }
      }
      state.tracking.set(branch, { upstream: true, ahead: 0, behind: 0, pending: 0 })
      if (!state.refs.remote.some((r) => r.name === `origin/${branch}`)) {
        state.refs = { ...state.refs, remote: [...state.refs.remote, fakeRef(`origin/${branch}`)] }
      }
      return { commits: 0, published: true }
    },
    gitUpdateBranch: async (target, branch) => {
      repo(target)
      if (!state.refs.local.some((r) => r.name === branch)) throw new Error(`${branch} is not a branch here.`)
      const t = state.tracking.get(branch)
      if (t?.upstream !== true) throw new Error(`${branch} has no upstream branch to pull from.`)
      return { commits: catchUp(t) }
    },
    gitPullFolder: async (path) => {
      const p = known(path)
      if (p.notRepo === true) throw new Error('fatal: not a git repository')
      const commits = catchUp(upstreamOf(currentOf(p)))
      if (commits > 0) emit('treeChanged')
      return { commits }
    },
    gitPullWorktree: async (target, branch) => {
      const p = repo(target)
      const holder = checkouts(p).find((c) => c.branch === branch)
      if (holder === undefined) throw new Error(`${branch} is no longer checked out in a worktree of this repository`)
      const commits = catchUp(upstreamOf(branch))
      emit('treeChanged')
      return { path: holder.path, commits }
    },

    listWorktrees: async (path) => {
      const p = known(path)
      return p.notRepo === true ? [] : otherCheckouts(p)
    },
    newSessionInWorktree: async (target, branch) => {
      const p = repo(target)
      const holder = checkouts(p).find((c) => c.branch === branch)
      if (holder === undefined) throw new Error(`${branch} is no longer checked out in a worktree of this repository`)
      return env.newSession(holder.path)
    },
    worktreeCreateOptions: async (path) => {
      const p = known(path)
      if (p.notRepo === true) throw new Error('fatal: not a git repository')
      return options(p)
    },
    worktreeCreate: async (path, request) => {
      const p = known(path)
      if (p.notRepo === true) throw new Error('fatal: not a git repository')
      const o = options(p)
      const name = request.name.trim()
      const problem = worktreeNameProblem(name, o.existingNames)
      if (problem !== null) throw new Error(problem)
      const choice = request.branch
      if (choice.kind === 'local' && o.checkedOut.includes(choice.branch)) throw new Error(`Branch '${choice.branch}' is already checked out in another worktree.`)
      if (choice.kind === 'new' && o.local.includes(choice.branch.trim())) throw new Error(`A local branch named '${choice.branch.trim()}' already exists.`)
      if (choice.kind === 'remote' && !o.remote.includes(choice.ref)) throw new Error(`invalid reference: ${choice.ref}`)
      const branch = choice.kind === 'local' ? choice.branch : choice.kind === 'remote' ? choice.ref.replace(/^[^/]+\//, '') : choice.branch.trim()
      addLocal(branch)
      const made = `${o.parentDir}/${name}`
      state.worktrees[rootOf(p)] = [...(state.worktrees[rootOf(p)] ?? []), { path: made, branch }]
      return env.newSession(made)
    },
  }
}
