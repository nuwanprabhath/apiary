import type { AppSettingsPayload } from '@shared/domain/settings'
import type { JsonStore } from '../fs/jsonStore'
import { type AppSettings, createSettingsStore, saveSettings, mergeSettingsPayload } from '../settings'

/**
 * Owns the in-memory `AppSettings` for the whole app (MAIN-16). Before this, `loadSettings` was
 * called anew at every read (about 10 call sites across `index.ts` and the IPC handlers), so every
 * read was a synchronous disk hit and every writer had to remember to re-read first or clobber a
 * change made in between. `SettingsService` reads the file once at construction (migrating and
 * writing back, exactly as `index.ts` used to do by hand) and keeps the result as its one source of
 * truth; every mutation goes through `patch`/`applyPayload`, which update the in-memory copy and
 * the file together, then notify subscribers.
 *
 * Each service that used to have its own settings mutator (`setClaudeBin`, `setAutoImportAll`,
 * `setSearchChatContent`, `setSearchSessionNotes`, `setPromptPath`, `setPluginEnabled`,
 * `setPluginSettings`, the updater's `saveSettings` callback) can instead call `onChange` and react
 * to the fields it cares about — see `main/ipc/index.ts` for where those subscriptions are wired up
 * during the migration to this class.
 */
export class SettingsService {
  private current: AppSettings
  private readonly listeners = new Set<(next: AppSettings, prev: AppSettings) => void>()

  private readonly store: JsonStore<AppSettings>

  constructor(file: string) {
    this.store = createSettingsStore(file)
    const loaded = this.store.load()
    this.current = loaded
    // Written straight back, so a migration applied on read is recorded — see `migrateSettings`'s
    // own doc comment ("Changing a default reaches nobody", CLAUDE.md). Without this it would be
    // re-applied on every launch, silently undoing a later deliberate change.
    saveSettings(this.store, loaded)
  }

  get(): Readonly<AppSettings> {
    return this.current
  }

  /** A direct, main-only patch (window bounds, the update-skip version) — atomic write, then
   *  notify. Renderer-originated changes go through `applyPayload` instead, which validates. */
  patch(p: Partial<AppSettings>): void {
    const prev = this.current
    this.current = { ...prev, ...p }
    saveSettings(this.store, this.current)
    for (const fn of this.listeners) fn(this.current, prev)
  }

  /**
   * Merges a settings payload arriving over IPC (see `mergeSettingsPayload`'s own doc comment for
   * why a missing field must mean "unchanged"), persists the result, and notifies subscribers.
   * Returns the merged settings so the caller (the `settingsSet` handler) can read back what was
   * actually applied, e.g. to decide whether `autoImportAll` was just switched on.
   */
  applyPayload(next: Partial<AppSettingsPayload>, knownPluginIds: ReadonlySet<string>): AppSettings {
    const prev = this.current
    this.current = mergeSettingsPayload(prev, next, knownPluginIds)
    saveSettings(this.store, this.current)
    for (const fn of this.listeners) fn(this.current, prev)
    return this.current
  }

  /** Notified after every `patch`/`applyPayload`. Returns an unsubscribe function. */
  onChange(fn: (next: AppSettings, prev: AppSettings) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}
