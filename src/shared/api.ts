/**
 * `ApiaryApi`: the renderer's one bridge into main, implemented by `src/preload/index.ts` and
 * type-checked against by `tests/component/fakeApiary.ts`. `CHANNELS` are the wire names it and
 * `main/ipc/registrar.ts` share. Both are now *derived* from `shared/ipc/contract.ts` (MAIN-11),
 * which is the single source of truth for the channel name, its argument shape and its result —
 * this file only re-exports them so existing `from '@shared/api'` imports keep working unchanged.
 *
 * The payload types it uses live in `shared/domain/*` and `shared/theme/*`, grouped by subject
 * rather than piled up here (SHARED-1) — this file re-exports the ones that used to be defined
 * here so existing `from '@shared/api'` imports keep working unchanged.
 */
export { CHANNELS, IPC, type ApiaryApi, type InvokeKey, type SendKey, type EventKey, type ArgsOf, type ResultOf, type PayloadOf } from './ipc/contract'

// Re-exported under their old names/locations so nothing importing `@shared/api` has to change
// (SHARED-1's barrel rule). `PluginSettingFieldPayload` used to be defined here; the canonical
// shared name (used by both main and the renderer) is `PluginSettingField`.
export type { CheckoutOutcome, FolderWorktree, GitStatus, GitRefs } from './domain/git'
export type { DiscoveredSession, ResumeConflict, NewSessionInfo } from './domain/session'
export type { TabTransfer, WindowLayoutReport, ActiveTabPayload } from './domain/tabs'
export type { AppSettingsPayload } from './domain/settings'
export type { LogStatusPayload } from './domain/log'
export type { UpdateStatusPayload } from './domain/update'
export type { PluginInfoPayload } from './domain/plugins'
export type { PluginBarItem as PluginBarItemPayload } from './domain/plugins'
export type { PluginSettingField as PluginSettingFieldPayload } from './domain/plugins'
export type { PtySessionInfo, PtySnapshot } from './domain/pty'
export type { SavedTheme, ThemeOptions, ThemeGenerateResult, ThemeState } from './theme/state'

