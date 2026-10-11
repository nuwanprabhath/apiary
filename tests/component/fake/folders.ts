/**
 * The folder browser (`main/folders/folderBrowser.ts`) in the fake, over a small modelled home:
 * the same folders `tests/contract/world.ts`'s `BROWSE_HOME` says the real loopback's home holds,
 * so one contract clause runs on both. Like main it holds the position (a browse id and the names
 * walked), lists folders only and sorted, hides dot-folders, and refuses a name that is not an
 * entry, a path, or a link leading outside home. The contract pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { BROWSE_MAX_ENTRIES, type BrowseView } from '@shared/domain/folders'
import { BROWSE_HOME } from '../../contract/world'
import type { Env } from './state'

type FoldersApi = Pick<ApiaryApi,
  'folderBrowseOpen' | 'folderBrowseEnter' | 'folderBrowseUp' | 'folderBrowseCrumb' | 'folderBrowseClose' | 'newSessionInBrowsedFolder'>

interface Folder {
  repo?: boolean
  children?: Record<string, Folder>
}

/** Where the fake browser starts; `/fixture/<name>` is the folder the contract's `folders` name. */
const FAKE_HOME = '/fixture'

/** `BROWSE_HOME`'s folders, plus the hidden ones a browser must not list (`.claude`, `work-a/.cache`). */
const HOME: Record<string, Folder> = {
  ...Object.fromEntries(BROWSE_HOME.folders.map((name): [string, Folder] => [name, name === BROWSE_HOME.nested.parent
    ? { children: { [BROWSE_HOME.nested.child]: {}, '.cache': {} } }
    : (BROWSE_HOME.repos as readonly string[]).includes(name) ? { repo: true } : {}])),
  '.claude': {},
}

/** Main's order (`folderBrowser.ts`): by lower-cased name in code units, a tie by the name itself. */
const byName = ([a]: [string, Folder], [b]: [string, Folder]): number => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()]
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1
}

export function foldersApi(env: Env): FoldersApi {
  const { state } = env
  const browses = new Map<string, string[]>()
  let counter = 0

  const walk = (segments: string[]): Record<string, Folder> => {
    let children = HOME
    for (const name of segments) children = children[name]?.children ?? {}
    return children
  }
  const listing = (segments: string[]): Record<string, Folder> => (segments.length === 0 ? HOME : walk(segments))
  const view = (id: string, segments: string[]): BrowseView => {
    const children = listing(segments)
    const links: [string, Folder][] = segments.length === 0 ? [...state.homeLinks].map((name) => [name, {}]) : []
    const entries = [...Object.entries(children), ...links]
      .filter(([name]) => !name.startsWith('.'))
      .sort(byName)
      .slice(0, BROWSE_MAX_ENTRIES)
      .map(([name, folder]) => ({ name, isRepo: folder.repo === true }))
    return { id, crumbs: ['~', ...segments], entries, atRoot: segments.length === 0 }
  }
  const at = (id: string): string[] => {
    const segments = browses.get(id)
    if (segments === undefined) throw new Error('This folder browser has closed. Open it again.')
    return segments
  }

  return {
    folderBrowseOpen: async () => {
      counter += 1
      const id = `browse-${String(counter)}`
      browses.set(id, [])
      return view(id, [])
    },
    folderBrowseEnter: async (id, name) => {
      const segments = at(id)
      if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('That is not a folder name.')
      if (!view(id, segments).entries.some((e) => e.name === name)) throw new Error('That folder is not here.')
      if (segments.length === 0 && state.homeLinks.has(name)) throw new Error('That folder is outside your home folder, or is gone.')
      segments.push(name)
      return view(id, segments)
    },
    folderBrowseUp: async (id) => {
      const segments = at(id)
      if (segments.length === 0) throw new Error('This is the top: there is nothing above home.')
      segments.pop()
      return view(id, segments)
    },
    folderBrowseCrumb: async (id, index) => {
      const segments = at(id)
      if (!Number.isInteger(index) || index < 0 || index > segments.length) throw new Error('That is not a place on this path.')
      segments.length = index
      return view(id, segments)
    },
    folderBrowseClose: (id) => { browses.delete(id) },
    newSessionInBrowsedFolder: async (id) => env.newSession([FAKE_HOME, ...at(id)].join('/')),
  }
}
