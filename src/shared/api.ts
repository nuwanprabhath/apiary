/**
 * `ApiaryApi`: the renderer's one bridge into main, implemented by `src/preload/index.ts` and
 * type-checked against by `tests/component/fakeApiary.ts`. `CHANNELS` are the wire names it and
 * `main/ipc/registrar.ts` share. Both derive from `shared/ipc/contract.ts`; this file only
 * re-exports them and the payload types from `shared/domain/*` and `shared/theme/*`.
 */
export { CHANNELS, IPC, type ApiaryApi } from './ipc/contract'

export type { DiscoveredSession } from './domain/session'
export type { TabTransfer, ActiveTabPayload } from './domain/tabs'
export type { AppSettingsPayload } from './domain/settings'
export type { LogStatusPayload } from './domain/log'
export type { UpdateStatusPayload } from './domain/update'
export type { PluginInfoPayload } from './domain/plugins'
export type { PluginBarItem as PluginBarItemPayload } from './domain/plugins'
export type { PluginSettingField as PluginSettingFieldPayload } from './domain/plugins'
export type { PtySessionInfo, PtySnapshot } from './domain/pty'
export type { SavedTheme, ThemeOptions, ThemeState } from './theme/state'

