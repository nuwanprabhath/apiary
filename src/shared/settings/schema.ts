/**
 * Every setting the renderer can read or write, declared once.
 *
 * A setting is one entry in `SETTINGS`: its runtime guard, its default, and its constraint (a range
 * for a number, a filter for a map). Everything else is derived from that entry —
 * `AppSettingsPayload` (the type), `DEFAULT_SETTINGS_PAYLOAD` (`shared/settingsDefaults.ts`),
 * `AppSettings` (`main/settings.ts`, which adds the main-only fields), the `settingsGet` mapping,
 * `mergeSettingsPayload`'s validation of whatever arrives over IPC, and the component tests' fake.
 * Before this, adding one setting meant 6 to 8 hand-edited files, and the merge only checked
 * `!== undefined`, so a boolean or the `plugins` map crossed the IPC boundary unchecked.
 *
 * Adding a setting is an entry here plus its control in `renderer/features/settings/sections/`.
 * Changing an *existing* default for people who already have a `settings.json` is not enough on its
 * own — see `SETTINGS_VERSION` and `migrateSettings` in `main/settings.ts`.
 */
import { clamp, isRecord, own } from '../guards'
import { bool, nullable, num, str, type Guard } from '../ipc/guards'
import { MAX_SEGMENTS } from '../promptPreview'

/** What a constraint may need that a pure shared module cannot look up for itself. */
export interface SettingContext {
  /** Plugin ids this build knows about; `pluginSettings` is filtered to them. */
  knownPluginIds: ReadonlySet<string>
  /** Node's `isAbsolute`, injected because `shared/` has no `node:path`. */
  isAbsolutePath: (path: string) => boolean
}

export interface SettingDef<T> {
  /** True only for a value of the setting's type. A value that fails it is never stored. */
  guard: Guard<T>
  default: T
  /** For a number: the inclusive range an out-of-range value is clamped into. */
  range?: { min: number; max: number }
  /**
   * Narrows or normalises a value that already passed `guard` (clamp it, filter it). Returning
   * `undefined` rejects the value, which leaves the setting as it was.
   */
  constrain?: (value: T, ctx: SettingContext) => T | undefined
}

const setting = <T>(def: SettingDef<T>): SettingDef<T> => def
const flag = (def: boolean) => setting<boolean>({ guard: bool, default: def })

const clampToRange = (min: number, max: number) => (n: number): number => clamp(Math.round(n), min, max)
const int = (def: number, min: number, max: number) =>
  ({ ...setting<number>({ guard: num, default: def, constrain: clampToRange(min, max) }), range: { min, max } })
/** `null` is a real value for these ("off"), so it passes straight through. */
const intOrNull = (def: number | null, min: number, max: number) => ({
  ...setting<number | null>({
    guard: nullable(num),
    default: def,
    constrain: (n) => (n === null ? null : clampToRange(min, max)(n)),
  }),
  range: { min, max },
})

type PluginSettings = Record<string, Record<string, string | number | boolean>>

const isBooleanMap: Guard<Record<string, boolean>> = (v): v is Record<string, boolean> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === 'boolean')
const isPluginSettings: Guard<PluginSettings> = (v): v is PluginSettings =>
  isRecord(v) && Object.values(v).every(isRecord)

/**
 * A non-null value becomes the binary `resumeCommand` and the theme generator invoke, and is
 * persisted and re-read on every launch (SEC-8), so it must be an absolute, bounded-length path.
 */
const absolutePathOrNull = (v: string | null, ctx: SettingContext): string | null | undefined =>
  v === null || (ctx.isAbsolutePath(v) && v.length <= 4096) ? v : undefined

/**
 * Plugin ids this build does not know about are dropped, and so is any value that is not a string,
 * number or boolean (SEC-8): the dialog only sends back what it was given, but the IPC boundary
 * cannot assume that, and an unbounded object would be persisted and re-read by whatever the
 * plugin's own settings code expects.
 */
const knownPluginsOnly = (raw: PluginSettings, ctx: SettingContext): PluginSettings => Object.fromEntries(
  Object.entries(raw)
    .filter(([id]) => ctx.knownPluginIds.has(id))
    .map(([id, values]) => [
      id,
      Object.fromEntries(
        Object.entries(values).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
      ),
    ]),
)

export const SETTINGS = {
  /** Explicit path to the claude binary, used when it is not on PATH. */
  claudeBin: setting<string | null>({ guard: nullable(str), default: null, constrain: absolutePathOrNull }),
  /** Import every discovered session automatically, instead of picking them by hand. */
  autoImportAll: flag(false),
  /** Minutes between automatic rescans, or null when periodic scanning is off. */
  autoImportIntervalMinutes: intOrNull(null, 1, 1440),
  /**
   * Whether activating a tab scrolls the sidebar to that session and highlights it. On by default:
   * with months of history in the tree, finding the row for the session you are looking at is
   * otherwise a hunt. Off for anyone who would rather the sidebar stayed where they left it.
   */
  revealActiveInSidebar: flag(true),
  /**
   * Use the operating system's own title bar and menu bar instead of Apiary's themed ones. Off by
   * default; for a window manager that does not get on with a custom title bar (some tiling ones).
   * Read when a window opens, so it applies to windows opened after the change (or a restart).
   */
  systemTitleBar: flag(false),
  /**
   * The transcript's message box drives the session as a chat, the way the VS Code extension does:
   * replies stream into the transcript, tools ask for permission there, and the view stays put.
   * Off: the message goes to the session's terminal, which is brought to the front.
   */
  transcriptChat: flag(false),
  /**
   * Start with each chat's tool calls (the IN and OUT boxes of Bash, Read, Edit and the rest) hidden,
   * so the transcript is what you said and what Claude said. Off by default: tool calls are shown.
   * The Chat tab's own "Hide tool calls" switch flips this for what you are looking at without
   * saving anything; this is the value it starts from.
   */
  hideToolCallIo: flag(false),
  /**
   * Whether the search box also matches the *contents* of conversations, not just their titles.
   * On by default; turning it off falls back to title-only search and stops the indexer running.
   */
  searchChatContent: flag(true),
  /**
   * Whether the notes people write on sessions are searchable. Separate from `searchChatContent`
   * because it is a different bargain: a note is a line the user typed on purpose, so indexing it
   * costs nothing and is what makes it findable later.
   */
  searchSessionNotes: flag(true),
  /** Whether the Recent section (sessions active in the last `recentSectionHours`) is shown. */
  recentSectionEnabled: flag(true),
  /** How far back "recent" looks. Clamped to 1..168 by the settings dialog, same as the update-check interval. */
  recentSectionHours: int(24, 1, 168),
  /**
   * Trim the working directory in the prompt of shells Apiary starts, to the last
   * `terminalPathSegments` folders. See pty/promptPath.ts — bash 4+ only, by design.
   *
   * One folder, not two. The paths this exists for look like
   * `~/projects/thing.worktrees/pipeline-issues`, and keeping two of those keeps
   * `thing.worktrees/pipeline-issues` — almost the whole thing. The last component is the one that
   * says which worktree you are in; everything before it is what was in the way.
   */
  terminalShortenPath: flag(true),
  /** How many trailing folders the trimmed prompt keeps. */
  terminalPathSegments: int(1, 1, MAX_SEGMENTS),
  /**
   * Show nothing but `$` as the prompt of shells Apiary starts — the path, user and host all go.
   * On by default: a terminal pane is narrow, and the session's header already says where it is.
   * See pty/promptPath.ts for how it is done in bash and zsh.
   */
  terminalMinimalPrompt: flag(true),
  /**
   * Which session-bar plugins are on, by plugin id. A map rather than a field per plugin so
   * adding one does not mean touching the settings shape — which is the point of plugins.
   */
  plugins: setting<Record<string, boolean>>({ guard: isBooleanMap, default: {} }),
  /**
   * Each plugin's own settings, namespaced by plugin id. Plugins declare what they take (see
   * plugins/types.ts) and Settings draws it, so nothing here needs a field per plugin.
   */
  pluginSettings: setting<PluginSettings>({ guard: isPluginSettings, default: {}, constrain: knownPluginsOnly }),
  /**
   * Update preferences. Checking is on by default — an app that can update itself and doesn't
   * mention it is how people end up months behind — but nothing is ever downloaded or installed
   * without the user saying so, which is what `updateAutoDownload: false` means.
   */
  updateAutomaticChecks: flag(true),
  /** Hours between automatic checks. Clamped to 1..168 by the service. */
  updateCheckIntervalHours: int(6, 1, 168),
  /** Fetch the update as soon as it is found, instead of after the user agrees. */
  updateAutoDownload: flag(false),
  /** Offer pre-release builds. */
  updateAllowPrerelease: flag(false),
  /**
   * Write a diagnostic log to disk. **Off by default and off means nothing is written** — see
   * main/log/logger.ts. It exists so a bug that only happens on someone else's machine leaves
   * something to read.
   */
  diagnosticsEnabled: flag(false),
  /** How long archived log files are kept. */
  logRetentionDays: int(7, 1, 90),
  /** Total disk the logs may take, across every file. */
  logMaxSizeMb: int(20, 1, 500),
}

export type SettingKey = keyof typeof SETTINGS
type ValueOf<D> = D extends SettingDef<infer T> ? T : never

/**
 * The renderer-facing subset of `AppSettings` (`main/settings.ts`), which also carries
 * `schemaVersion`, `updateSkippedVersion` and `windowBounds` — main-only bookkeeping the renderer
 * never needs to see or set. Derived from `SETTINGS`, so a field cannot exist without a guard and
 * a default.
 */
export type AppSettingsPayload = { [K in SettingKey]: ValueOf<(typeof SETTINGS)[K]> }

// The one place the per-key types are erased, so the loops below can run over every entry.
const SETTING_ENTRIES = Object.entries(SETTINGS) as [SettingKey, SettingDef<unknown>][]

/** The default of every setting. `DEFAULT_SETTINGS_PAYLOAD` is this, evaluated once. */
export function settingsDefaults(): AppSettingsPayload {
  return Object.fromEntries(SETTING_ENTRIES.map(([k, def]) => [k, def.default])) as AppSettingsPayload
}

/** Just the payload fields of `source` — what `settingsGet` hands the renderer. */
export function pickPayload(source: AppSettingsPayload): AppSettingsPayload {
  return Object.fromEntries(SETTING_ENTRIES.map(([k]) => [k, source[k]])) as AppSettingsPayload
}

export interface PayloadMerge {
  merged: AppSettingsPayload
  /** Keys whose incoming value failed its guard or constraint; they kept their current value. */
  rejected: SettingKey[]
}

/**
 * Applies the fields of `next` that are valid and leaves the rest as they were.
 *
 * **A missing field means "unchanged", never "off"** (CLAUDE.md "Settings arriving over IPC"):
 * `next` crosses a process boundary from a renderer that may be a different build, so an absent key
 * must not be written across as `undefined`. A *present* value that fails its guard or constraint
 * is treated the same way and reported in `rejected`; a number outside its range is clamped
 * rather than rejected, as the dialog's own inputs do.
 */
export function mergePayload(
  current: AppSettingsPayload,
  next: Partial<AppSettingsPayload>,
  ctx: SettingContext,
): PayloadMerge {
  const merged: Record<string, unknown> = { ...current }
  const rejected: SettingKey[] = []
  for (const [key, def] of SETTING_ENTRIES) {
    const value = own(next, key)
    if (value === undefined) continue
    const accepted = def.guard(value) ? (def.constrain ? def.constrain(value, ctx) : value) : undefined
    if (accepted === undefined) rejected.push(key)
    else merged[key] = accepted
  }
  return { merged: merged as AppSettingsPayload, rejected }
}
