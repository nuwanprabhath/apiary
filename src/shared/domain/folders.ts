/** One folder in a browse (`main/folders/folderBrowser.ts`): its name only, never a path. */
export interface BrowseEntry {
  name: string
  /** The folder has a `.git` (a repository, or a worktree's link file). */
  isRepo: boolean
}

/**
 * What a folder browser shows: the work machine holds the position (ADR-0001), so the renderer
 * has an opaque `id`, display names and nothing it could pass back as a path.
 */
export interface BrowseView {
  id: string
  /** Display names from home down: `['~', 'projects', 'apiary']`. */
  crumbs: string[]
  entries: BrowseEntry[]
  atRoot: boolean
}

/** Most folders one listing shows; a folder with more is cut, not paged. */
export const BROWSE_MAX_ENTRIES = 500
