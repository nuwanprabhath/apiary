import { describe, expect, it } from 'vitest'
import {
  CHAT_SETTINGS_REGISTRY, SHOW_TOOL_CALLS, chatSettingRows, chatSettingValue,
  type ChatSetting,
} from '../../src/renderer/state/chatSettings'

const SHOWN = { hideToolCallIo: false }
const HIDDEN = { hideToolCallIo: true }

const ALPHA: ChatSetting = { id: 'alpha', label: 'Alpha', kind: 'toggle', default: () => true }
const BETA: ChatSetting = { id: 'beta', label: 'Beta mode', kind: 'toggle', default: (app) => !app.hideToolCallIo }
const TWO = [ALPHA, BETA]

describe('the chat settings registry', () => {
  it('holds the show-tool-calls setting, stored under its own id', () => {
    expect(CHAT_SETTINGS_REGISTRY).toContain(SHOW_TOOL_CALLS)
    expect(SHOW_TOOL_CALLS.id).toBe('showToolCalls')
    expect(SHOW_TOOL_CALLS.label).toBe('Show tool calls')
  })
})

describe('chatSettingValue', () => {
  it('follows the Settings default when this chat has no choice of its own', () => {
    expect(chatSettingValue(SHOW_TOOL_CALLS, {}, SHOWN)).toBe(true)
    expect(chatSettingValue(SHOW_TOOL_CALLS, {}, HIDDEN)).toBe(false)
  })

  it('a choice in this chat wins over the Settings default, in both directions', () => {
    expect(chatSettingValue(SHOW_TOOL_CALLS, { showToolCalls: false }, SHOWN)).toBe(false)
    expect(chatSettingValue(SHOW_TOOL_CALLS, { showToolCalls: true }, HIDDEN)).toBe(true)
  })
})

describe('chatSettingRows', () => {
  const read = (setting: ChatSetting): boolean => chatSettingValue(setting, { beta: false }, SHOWN)

  it('lists every setting of the registry for an empty filter, each with its value', () => {
    expect(chatSettingRows(TWO, '', read)).toEqual([
      { setting: ALPHA, value: true },
      { setting: BETA, value: false },
    ])
  })

  it('keeps only the settings whose label the filter matches', () => {
    expect(chatSettingRows(TWO, 'bm', read).map((row) => row.setting.id)).toEqual(['beta'])
    expect(chatSettingRows(TWO, 'zzz', read)).toEqual([])
  })
})

