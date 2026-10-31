/**
 * Every setting the renderer can read or write, declared once.
 *
 * A setting is one entry in `SETTINGS`: its runtime guard, its default, and its constraint (a range
 * for a number, a filter for a map). Everything else is derived from that entry —
 * `AppSettingsPayload` (the type), `DEFAULT_SETTINGS_PAYLOAD` (`shared/settingsDefaults.ts`),
 * `AppSettings` (`main/settings.ts`, which adds the main-only fields), the `settingsGet` mapping,
 * `mergeSettingsPayload`'s validation of whatever arrives over IPC, and the component tests' fake.
 *
 * Adding a setting is an entry here plus its control in `renderer/features/settings/sections/`.
 * Changing an *existing* default for people who already have a `settings.json` is not enough on its
 * own — see `SETTINGS_VERSION` and `migrateSettings` in `main/settings.ts`.
 */
import { clamp, isRecord, own } from '../guards'
import { bool, nullable, num, str, type Guard } from '../ipc/guards'
import { MAX_SEGMENTS } from '../promptPreview'
import { isBusyAnimationId, isBusyColorId, type BusyAnimationId, type BusyColorId } from '../domain/busyAnimation'
import type { ResidentConfig } from '../domain/residents'
import { constrainResidents, isResidentList } from './residents'

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
export type MotionSetting = 'auto' | 'full' | 'reduced'
const MOTION_SETTINGS: readonly MotionSetting[] = ['auto', 'full', 'reduced']
const isMotionSetting: Guard<MotionSetting> = (v): v is MotionSetting => MOTION_SETTINGS.some((m) => m === v)

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
 * persisted and re-read on every launch, so it must be an absolute, bounded-length path.
 */
const absolutePathOrNull = (v: string | null, ctx: SettingContext): string | null | undefined =>
  v === null || (ctx.isAbsolutePath(v) && v.length <= 4096) ? v : undefined

/**
 * Plugin ids this build does not know about are dropped, and so is any value that is not a string,
 * number or boolean: the dialog only sends back what it was given, but the IPC boundary
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
  /**
   * Serve this machine's sessions to another Apiary over SSH, through a Unix socket in `~/.apiary`
   * (docs/proposals/2026-10-10-remote-access.md). Opens no network port. Off by default.
   */
  remoteAccess: flag(false),
  /** Also ask a home machine for the pairing code shown in Settings → General; SSH stays the authentication. */
  remoteAccessPairing: flag(false),
  /** Minutes between automatic rescans, or null when periodic scanning is off. */
  autoImportIntervalMinutes: intOrNull(null, 1, 1440),
  /** Whether activating a tab scrolls the sidebar to that session and highlights it. */
  revealActiveInSidebar: flag(true),
  /**
   * Use the operating system's own title bar and menu bar instead of Apiary's themed ones (for
   * tiling window managers that fight a custom one). Read when a window opens, so it applies to
   * windows opened after the change.
   */
  systemTitleBar: flag(false),
  /**
   * The transcript's message box drives the session as a chat: replies stream into the transcript
   * and tools ask for permission there. Off: the message goes to the session's terminal.
   */
  transcriptChat: flag(false),
  /** Whether search also matches conversation contents; off falls back to titles and stops the indexer. */
  searchChatContent: flag(true),
  /** Whether session notes are searchable. Separate from `searchChatContent`: a note is a line typed on purpose. */
  searchSessionNotes: flag(true),
  /** Whether the Recent section (sessions active in the last `recentSectionHours`) is shown. */
  recentSectionEnabled: flag(true),
  /** How far back "recent" looks. Clamped to 1..168 by the settings dialog, same as the update-check interval. */
  recentSectionHours: int(24, 1, 168),
  /** Whether sessions not used for `hideOldSessionsDays` drop out of the sidebar tree (search still finds them). */
  hideOldSessionsEnabled: flag(false),
  /** How many days without activity before a session is hidden from the tree. */
  hideOldSessionsDays: int(30, 1, 3650),
  /**
   * Trim the working directory in the prompt of shells Apiary starts, to the last
   * `terminalPathSegments` folders. See pty/promptPath.ts — bash 4+ only, by design.
   * The default is one folder: in `~/projects/thing.worktrees/pipeline-issues` the last component
   * is the one that says which worktree you are in.
   */
  terminalShortenPath: flag(true),
  /** How many trailing folders the trimmed prompt keeps. */
  terminalPathSegments: int(1, 1, MAX_SEGMENTS),
  /**
   * Show nothing but `$` as the prompt of shells Apiary starts — the path, user and host all go.
   * See pty/promptPath.ts for how it is done in bash and zsh.
   */
  terminalMinimalPrompt: flag(true),
  /** Which session-bar plugins are on, by plugin id. */
  plugins: setting<Record<string, boolean>>({ guard: isBooleanMap, default: {} }),
  /** Each plugin's own settings, namespaced by plugin id; plugins declare them (see plugins/types.ts). */
  pluginSettings: setting<PluginSettings>({ guard: isPluginSettings, default: {}, constrain: knownPluginsOnly }),
  /**
   * Update preferences. Nothing is downloaded or installed without the user saying so, which is
   * what `updateAutoDownload: false` means.
   */
  updateAutomaticChecks: flag(true),
  /** Hours between automatic checks. Clamped to 1..168 by the service. */
  updateCheckIntervalHours: int(6, 1, 168),
  /** Fetch the update as soon as it is found, instead of after the user agrees. */
  updateAutoDownload: flag(false),
  /** Offer pre-release builds. */
  updateAllowPrerelease: flag(false),
  /**
   * Write a diagnostic log to disk. **Off means nothing is written** — see main/log/logger.ts.
   */
  diagnosticsEnabled: flag(false),
  /** How long archived log files are kept. */
  logRetentionDays: int(7, 1, 90),
  /** Total disk the logs may take, across every file. */
  logMaxSizeMb: int(20, 1, 500),
  /** Spellcheck language code (e.g. 'fr-FR'), or 'system' to follow the system language. */
  proofingLanguage: setting<string>({ guard: str, default: 'system' }),
  /**
   * Continuous animations in the chrome. `auto` turns them off when the system asks for less motion
   * or Apiary composites without the GPU; `full` and `reduced` are the person's explicit choice.
   */
  motion: setting<MotionSetting>({ guard: isMotionSetting, default: 'auto' }),
  /** The animation beside "Claude is working" (`shared/domain/busyAnimation.ts`). */
  busyAnimation: setting<BusyAnimationId>({ guard: isBusyAnimationId, default: 'spark' }),
  /** Its colour; an animation that does not offer it uses its own first (`busyColorFor`). */
  busyAnimationColor: setting<BusyColorId>({ guard: isBusyColorId, default: 'theme' }),
  /** The resident agents (`main/residents/`): each one's name, schedule and models, added one kind's defaults at a time. */
  residents: setting<ResidentConfig[]>({ guard: isResidentList, default: [], constrain: constrainResidents }),
}

/** Settings whose control saves them at once, outside the dialog's Save (Themes: Animations, the
 *  working animation, and every Residents card). The dialog's draft still holds what they were when
 *  it opened, so its Save sends these as saved. A control that saves at once writes through
 *  `saveInstantSetting`, which takes only these keys. */
export const INSTANT_SETTINGS = ['motion', 'busyAnimation', 'busyAnimationColor', 'residents'] as const satisfies readonly SettingKey[]
export type InstantSettingKey = (typeof INSTANT_SETTINGS)[number]

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
