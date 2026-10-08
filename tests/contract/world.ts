/**
 * The world both implementations of `window.apiary` are put in before `bridgeContract.ts` runs
 * (TEST-5): the one window they model, and the plugins they are configured with. Pure data, so the
 * real loopback (`tests/integration/contract.test.ts`) builds its main-process plugins around it
 * and the fake (`tests/component/contract.test.tsx`) builds its payloads from it. Neither can then
 * describe a different plugin than the other, and a clause can speak in these ids.
 */
import type { PluginBarItem, PluginSettingField } from '@shared/domain/plugins'
import type { StatusBarItem, StatusBarPanel } from '@shared/domain/statusBar'

/**
 * The window the contract runs in. Number 1, filling a known rectangle, so a clause can drop a tab
 * inside it ("onto this window") or far outside every window ("onto the desktop"). A tab torn off
 * lands in window `DETACHED_WINDOW_NUMBER`, which both implementations treat as already open.
 */
export const THIS_WINDOW = { number: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 } } as const
export const DETACHED_WINDOW_NUMBER = 2
export const INSIDE_THIS_WINDOW = { x: 40, y: 40 } as const
export const OUTSIDE_EVERY_WINDOW = { x: 5000, y: 5000 } as const

/** A session-bar plugin: puts one `badge` button on every session's bar. */
export const BAR_PLUGIN = {
  id: 'contract-badge',
  name: 'Contract badge',
  description: 'Puts a badge on every session bar.',
  fields: [{ kind: 'number', key: 'level', label: 'Level', default: 3, min: 1, max: 9 }] satisfies PluginSettingField[],
} as const

export const BAR_ITEM: Omit<PluginBarItem, 'pluginId'> = {
  id: 'badge', icon: 'link', label: 'badge', title: 'Contract badge', action: { kind: 'none' }, tone: 'normal',
}

/** A status-bar plugin: one item with a dashboard behind it. */
export const STATUS_PLUGIN = {
  id: 'contract-meter',
  name: 'Contract meter',
  description: 'A meter in the status bar.',
  fields: [] satisfies PluginSettingField[],
} as const

export const STATUS_ITEM: Omit<StatusBarItem, 'pluginId'> = {
  id: 'meter', icon: 'gauge', text: 'meter 42', title: 'Contract meter', tone: 'normal', action: { kind: 'panel' }, detail: [],
}

export const STATUS_PANEL: StatusBarPanel = {
  title: 'Contract meter',
  refreshable: true,
  sections: [{ kind: 'note', text: 'All quiet.' }],
}

/** A status-bar plugin that must be asked before it does anything: one item, a consent prompt, until answered. */
export const CONSENT_PLUGIN = {
  id: 'contract-ask',
  name: 'Contract ask',
  description: 'Asks before it shows anything.',
  fields: [] satisfies PluginSettingField[],
} as const

export const CONSENT_ITEM: Omit<StatusBarItem, 'pluginId'> = {
  id: 'ask',
  text: 'allow?',
  title: 'Contract ask',
  tone: 'normal',
  action: { kind: 'consent', prompt: { title: 'Allow it?', lines: ['It reads something.'], allow: 'Allow', deny: 'Not now' } },
  detail: [],
}

/** The release the update feed offers in both implementations. */
export const FEED_VERSION = '9.9.9'
