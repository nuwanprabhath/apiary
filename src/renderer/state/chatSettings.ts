import { fuzzyScore } from '@shared/fuzzy'

/** What a per-chat setting may default from: the app-wide Settings it overrides. */
export interface ChatDefaults {
  hideToolCallIo: boolean
}

/**
 * One per-chat setting. The next one is one more entry in `CHAT_SETTINGS_REGISTRY`: the "/" menu
 * lists every entry, and the store reads and writes its value by `id`.
 */
export interface ChatSetting {
  id: string
  label: string
  kind: 'toggle'
  /** The value for a chat that has made no choice, from the app-wide Settings. */
  default: (app: ChatDefaults) => boolean
  describe?: string
}

type ChatSettingValues = Record<string, boolean | undefined>

export function chatSettingValue(setting: ChatSetting, values: ChatSettingValues, app: ChatDefaults): boolean {
  return values[setting.id] ?? setting.default(app)
}

export function chatSettingRows(
  registry: readonly ChatSetting[],
  query: string,
  read: (setting: ChatSetting) => boolean,
): { setting: ChatSetting; value: boolean }[] {
  return registry
    .filter((setting) => fuzzyScore(query, setting.label) !== null)
    .map((setting) => ({ setting, value: read(setting) }))
}

export const SHOW_TOOL_CALLS: ChatSetting = {
  id: 'showToolCalls',
  label: 'Show tool calls',
  kind: 'toggle',
  default: (app) => !app.hideToolCallIo,
  describe: 'Shows the input and output of tool calls in this chat only',
}

export const CHAT_SETTINGS_REGISTRY: readonly ChatSetting[] = [SHOW_TOOL_CALLS]
