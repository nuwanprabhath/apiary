/**
 * What the contract's clause files share: the harness types, the tree helpers, and the listener that
 * records every event the bridge delivers. Imports nothing from Node or the DOM (it runs under both
 * Vitest configs), and nothing from either implementation.
 */
import type { ApiaryApi } from '@shared/api'
import type { ContextMenuParamsLike, EditCommand } from '@shared/domain/contextMenu'
import { IPC, type EventKey, type PayloadOf } from '@shared/ipc/contract'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import type { ProjectNode, SessionNode } from '@shared/types'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'

export interface BridgeOptions {
  /** Whether the standard sessions start imported into the tree (default true). */
  imported?: boolean
  /** Adds one more session, in the "work-a" folder, with this many transcript messages. */
  longSessionMessages?: number
  /** A session some other process (a terminal outside the app) is already running. */
  liveSession?: SessionId
  /** The native folder picker is dismissed instead of answering with `Bridge.folders.picked`. */
  cancelPicker?: boolean
}

export interface Bridge {
  api: ApiaryApi
  /**
   * Folder paths the implementation uses, for the calls that take one. `workA` and `workB` are plain
   * folders; `repo` is a repository (on `main`, with an `origin` that also has `release/1`) whose
   * worktree `worktree` is on `feature/wt`; `picked` is what the folder picker answers.
   * A clause passes them back and never looks inside them.
   */
  folders: { workA: string; workB: string; repo: string; worktree: string; picked: string }
  /** The addresses the app asked the operating system to open, in order. */
  openedUrls(): string[]
  /** The text the app asked the operating system's clipboard to hold, in order. */
  copied(): string[]
  /** The edits the window was asked to make, in order, as main ran them (`editCommand`). */
  editing(): EditCommand[]
  /** A right-click the page does not answer itself, as Chromium reports it to main. */
  rightClick(params: ContextMenuParamsLike): void
  /** What happens in the world outside the app, which no call can cause. */
  outside: {
    /** A commit is made in the repository's `main` (in a terminal, say) and not pushed. */
    commitLocally(): Promise<void>
    /** Someone else pushes a commit to `origin/main`; this clone does not know until it fetches. */
    advanceRemote(): Promise<void>
  }
  cleanup(): void | Promise<void>
}

export type MakeBridge = (options: BridgeOptions) => Promise<Bridge>

/** What a clause file is handed: the bridge under test (fresh for every test) and what it has said. */
export interface Ctx {
  readonly api: ApiaryApi
  readonly bridge: Bridge
  readonly heard: Heard
  /** Replaces the bridge with a fresh one made with `options` (for a test that needs a different start). */
  restart(options: BridgeOptions): Promise<void>
}

/** Every event the bridge delivers, recorded through its own `on…` subscriptions. */
export interface Heard {
  /** How many times `event` has been delivered since the bridge was made or `reset()`. */
  count(event: EventKey): number
  /** What each delivery carried, in order. */
  payloads<K extends EventKey>(event: K): PayloadOf<K>[]
  /** Forgets everything heard so far. */
  reset(): void
  stop(): void
}

type Subscribe = (cb: (...args: never[]) => void) => () => void

function subscriptionOf(api: ApiaryApi, key: string): Subscribe {
  const name = `on${key[0].toUpperCase()}${key.slice(1)}`
  const found = Object.entries(api).find(([k]) => k === name)?.[1]
  if (typeof found !== 'function') throw new Error(`window.apiary has no ${name}`)
  return found as Subscribe
}

export function listen(api: ApiaryApi): Heard {
  let log: { event: string; args: unknown[] }[] = []
  const offs = Object.entries(IPC)
    .filter(([, spec]) => spec.kind === 'event')
    .map(([key]) => subscriptionOf(api, key)((...args: never[]) => { log.push({ event: key, args }) }))
  return {
    count: (event) => log.filter((e) => e.event === event).length,
    payloads: <K extends EventKey>(event: K) => log.filter((e) => e.event === event).map((e) => e.args as PayloadOf<K>),
    reset: () => { log = [] },
    stop: () => { for (const off of offs) off() },
  }
}

export interface Flat { session: SessionNode; folder: ProjectNode }

export function flatten(nodes: ProjectNode[]): Flat[] {
  return nodes.flatMap((folder) => [
    ...folder.sessions.map((session) => ({ session, folder })),
    ...flatten(folder.children),
  ])
}

export const titles = (tree: ProjectNode[]): string[] => flatten(tree).map((f) => f.session.title).sort()
export const sessionOf = (tree: ProjectNode[], id: string): Flat | undefined =>
  flatten(tree).find((f) => f.session.sessionId === id)

export const LONG_SESSION = { id: asSessionId('55555555-5555-5555-5555-555555555555'), title: 'Long paging session' } as const

/** What the contract seeds both implementations with, for clarity at the call sites. */
export const STANDARD_TITLES = Object.values(STD).map((s) => s.title)
