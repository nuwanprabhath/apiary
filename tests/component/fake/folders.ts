/**
 * The folder browser (`main/folders/folderBrowser.ts`) in the fake, over a small modelled home:
 * the same folders `tests/contract/world.ts`'s `BROWSE_HOME` says the real loopback's home holds,
 * so one contract clause runs on both. Like main it holds the position (a browse id and the names
 * walked), lists folders only and sorted, hides dot-folders, and refuses a name that is not an
 * entry, a path, or a link leading outside home. The contract pins it.
 */
import type { ApiaryApi } from '@shared/api'
import { BROWSE_MAX_ENTRIES, type BrowseView } from '@shared/domain/folders'
import type { Env } from './state'

type FoldersApi = Pick<ApiaryApi,
  'folderBrowseOpen' | 'folderBrowseEnter' | 'folderBrowseUp' | 'folderBrowseCrumb' | 'folderBrowseClose' | 'newSessionInBrowsedFolder'>

interface Folder {
  repo?: boolean
  children?: Record<string, Folder>
}

/** Where the fake browser starts; `/fixture/<name>` is the folder the contract's `folders` name. */
const FAKE_HOME = '/fixture'

const HOME: Record<string, Folder> = {
  '.claude': {},
  'origin.git': {},
  picked: {},
  'repo-c': { repo: true },
  'repo-c-wt': { repo: true },
  'work-a': { children: { src: {}, '.cache': {} } },
  'work-b': {},
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
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
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
