/**
 * The renderer-facing subset of `AppSettings` (`main/settings.ts`), which also carries
 * `schemaVersion`, `updateSkippedVersion` and `windowBounds` — main-only bookkeeping the renderer
 * never needs to see or set. `AppSettings extends AppSettingsPayload` (MAIN-22 / SHARED-2), so the
 * 20 shared fields are declared once, here, with `AppSettings`'s own richer comments moved along
 * with them.
 */
export interface AppSettingsPayload {
  /** Explicit path to the claude binary, used when it is not on PATH. */
  claudeBin: string | null
  /** Import every discovered session automatically, instead of picking them by hand. */
  autoImportAll: boolean
  /** Minutes between automatic rescans, or null when periodic scanning is off. */
  autoImportIntervalMinutes: number | null
  /**
   * Whether activating a tab scrolls the sidebar to that session and highlights it. On by default:
   * with months of history in the tree, finding the row for the session you are looking at is
   * otherwise a hunt. Off for anyone who would rather the sidebar stayed where they left it.
   */
  revealActiveInSidebar: boolean
  /**
   * Use the operating system's own title bar and menu bar instead of Apiary's themed ones. Off by
   * default; for a window manager that does not get on with a custom title bar (some tiling ones).
   * Read when a window opens, so it applies to windows opened after the change (or a restart).
   */
  systemTitleBar: boolean
  /**
   * Whether the search box also matches the *contents* of conversations, not just their titles.
   * On by default; turning it off falls back to title-only search and stops the indexer running.
   */
  searchChatContent: boolean
  /**
   * Whether the notes people write on sessions are searchable. Separate from `searchChatContent`
   * because it is a different bargain: a note is a line the user typed on purpose, so indexing it
   * costs nothing and is what makes it findable later.
   */
  searchSessionNotes: boolean
  /** Whether the Recent section (sessions active in the last `recentSectionHours`) is shown. */
  recentSectionEnabled: boolean
  /** How far back "recent" looks. Clamped to 1..168 by the settings dialog, same as the update-check interval. */
  recentSectionHours: number
  /**
   * Trim the working directory in the prompt of shells Apiary starts, to the last
   * `terminalPathSegments` folders. See pty/promptPath.ts — bash 4+ only, by design.
   *
   * One folder, not two. The paths this exists for look like
   * `~/projects/thing.worktrees/pipeline-issues`, and keeping two of those keeps
   * `thing.worktrees/pipeline-issues` — almost the whole thing. The last component is the one that
   * says which worktree you are in; everything before it is what was in the way.
   */
  terminalShortenPath: boolean
  /** How many trailing folders the trimmed prompt keeps. */
  terminalPathSegments: number
  /**
   * Show nothing but `$` as the prompt of shells Apiary starts — the path, user and host all go.
   * On by default: a terminal pane is narrow, and the session's header already says where it is.
   * See pty/promptPath.ts for how it is done in bash and zsh.
   */
  terminalMinimalPrompt: boolean
  /**
   * Which session-bar plugins are on, by plugin id. A map rather than a field per plugin so
   * adding one does not mean touching the settings shape — which is the point of plugins.
   */
  plugins: Record<string, boolean>
  /**
   * Each plugin's own settings, namespaced by plugin id. Plugins declare what they take (see
   * plugins/types.ts) and Settings draws it, so nothing here needs a field per plugin.
   */
  pluginSettings: Record<string, Record<string, string | number | boolean>>
  /**
   * Update preferences. Checking is on by default — an app that can update itself and doesn't
   * mention it is how people end up months behind — but nothing is ever downloaded or installed
   * without the user saying so, which is what `updateAutoDownload: false` means.
   */
  updateAutomaticChecks: boolean
  /** Hours between automatic checks. Clamped to 1..168 by the service. */
  updateCheckIntervalHours: number
  /** Fetch the update as soon as it is found, instead of after the user agrees. */
  updateAutoDownload: boolean
  /** Offer pre-release builds. */
  updateAllowPrerelease: boolean
  /**
   * Write a diagnostic log to disk. **Off by default and off means nothing is written** — see
   * main/log/logger.ts. It exists so a bug that only happens on someone else's machine leaves
   * something to read.
   */
  diagnosticsEnabled: boolean
  /** How long archived log files are kept. */
  logRetentionDays: number
  /** Total disk the logs may take, across every file. */
  logMaxSizeMb: number
}
