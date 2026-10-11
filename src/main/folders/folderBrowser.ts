import { randomBytes } from 'node:crypto'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BROWSE_MAX_ENTRIES, type BrowseEntry, type BrowseView } from '@shared/domain/folders'
import { realPathInside } from '../fs/confine'

export const BROWSE_IDLE_MS = 10 * 60 * 1000
export const BROWSE_MAX_OPEN = 20

export interface FolderBrowserDeps {
  /** Where every browse starts and which it can never leave. */
  home: string
  now?: () => number
}

/** One open browse: the names walked down from home (never a path), re-resolved and re-confined on every step. */
interface Browse {
  segments: string[]
  lastUsedMs: number
}

const sortKey = (name: string): string => name.toLowerCase()

/**
 * Lets a window on another machine choose a folder of this one without ever supplying a path
 * (ADR-0001): it holds an unguessable id, and every step is a child's name, a crumb index or "up".
 * Every position is confined to home by real path, so a symlink out of home is refused.
 */
export class FolderBrowser {
  /** Insertion order is least recently used first: a touch moves a browse to the end. Idle ones are
   *  dropped by `sweep`, so an expired id behaves as one never issued. */
  private readonly browses = new Map<string, Browse>()
  private readonly now: () => number

  constructor(private readonly deps: FolderBrowserDeps) {
    this.now = deps.now ?? Date.now
  }

  async open(): Promise<BrowseView> {
    this.sweep()
    while (this.browses.size >= BROWSE_MAX_OPEN) {
      const oldest = this.browses.keys().next()
      if (oldest.done === true) break
      this.browses.delete(oldest.value)
    }
    await realpath(this.deps.home) // fail here, not on the first step, when home is gone
    const id = randomBytes(16).toString('hex')
    this.browses.set(id, { segments: [], lastUsedMs: this.now() })
    return this.view(id)
  }

  async enter(id: string, name: string): Promise<BrowseView> {
    const browse = this.touch(id)
    if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new Error('That is not a folder name.')
    }
    const { entries } = await this.list(await this.resolve(browse.segments))
    if (!entries.some((e) => e.name === name)) throw new Error('That folder is not here.')
    await this.resolve([...browse.segments, name])
    browse.segments.push(name)
    return this.view(id)
  }

  async up(id: string): Promise<BrowseView> {
    const browse = this.touch(id)
    if (browse.segments.length === 0) throw new Error('This is the top: there is nothing above home.')
    browse.segments.pop()
    return this.view(id)
  }

  /** Jumps to the ancestor `index` names down the crumbs (0 is home). */
  async crumb(id: string, index: number): Promise<BrowseView> {
    const browse = this.touch(id)
    if (!Number.isInteger(index) || index < 0 || index > browse.segments.length) throw new Error('That is not a place on this path.')
    browse.segments.length = index
    return this.view(id)
  }

  close(id: string): void {
    this.browses.delete(id)
  }

  /** The folder a session starts in. Main only: it is never sent to a renderer. */
  async current(id: string): Promise<string> {
    return this.resolve(this.touch(id).segments)
  }

  /** The real path of home plus `segments`, which must still lie inside home (a link may have moved). */
  private async resolve(segments: string[]): Promise<string> {
    const dir = await realPathInside(this.deps.home, join(this.deps.home, ...segments))
    if (dir === null) throw new Error('That folder is outside your home folder, or is gone.')
    return dir
  }

  private sweep(): void {
    const cutoff = this.now() - BROWSE_IDLE_MS
    for (const [id, b] of this.browses) if (b.lastUsedMs < cutoff) this.browses.delete(id)
  }

  private touch(id: string): Browse {
    this.sweep()
    const browse = this.browses.get(id)
    if (browse === undefined) throw new Error('This folder browser has closed. Open it again.')
    browse.lastUsedMs = this.now()
    this.browses.delete(id)
    this.browses.set(id, browse)
    return browse
  }

  private async view(id: string): Promise<BrowseView> {
    const browse = this.touch(id)
    const { entries } = await this.list(await this.resolve(browse.segments))
    return { id, crumbs: ['~', ...browse.segments], entries, atRoot: browse.segments.length === 0 }
  }

  private async list(dir: string): Promise<{ entries: BrowseEntry[] }> {
    const dirents = await readdir(dir, { withFileTypes: true })
    const names: string[] = []
    for (const d of dirents) {
      if (d.name.startsWith('.')) continue
      if (d.isDirectory() || (d.isSymbolicLink() && (await isDirectory(join(dir, d.name))))) names.push(d.name)
    }
    names.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : a < b ? -1 : 1))
    const entries = await Promise.all(
      names.slice(0, BROWSE_MAX_ENTRIES).map(async (name) => ({ name, isRepo: await exists(join(dir, name, '.git')) })),
    )
    return { entries }
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false // a dangling link is not a folder to show
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false // no .git here
  }
}
