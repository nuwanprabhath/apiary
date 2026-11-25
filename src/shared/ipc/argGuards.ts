import type { Guard } from './guards'
import { isTerminalRef, type PtyId, type SessionId, type TerminalRef } from '../domain/ids'
import type { ReportedTab } from '../domain/tabs'
import { isGitTarget, type GitTarget } from '../domain/git'
import {
  isChatDecision, isChatEffort, isChatModel, isChatPermissionMode,
  type AsideTurn, type ChatDecision, type ChatEffort, type ChatModel, type ChatPermissionMode,
} from '../domain/chat'
import { isResidentKindId, type ResidentKindId } from '../domain/residents'
import { RESIDENT_ID_RE } from '../settings/residents'
import { isRecord } from '../guards'
import { SCREEN_SETTING_KEYS, type SettingKey } from '../settings/schema'

/** The argument guards of the IPC contract (`contract.ts`) that are more than a `guards.ts` primitive. */

// Boundary guards for branded ids: the one place a string arriving over IPC becomes a branded id.
// On the wire the ids are plain strings; only `TerminalRef` is an object.
export const sessionIdArg: Guard<SessionId> = (v): v is SessionId => typeof v === 'string'
export const ptyIdArg: Guard<PtyId> = (v): v is PtyId => typeof v === 'string'
export const byteCountArg: Guard<number> = (v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
export const terminalRefArg: Guard<TerminalRef> = isTerminalRef
export const gitTargetArg: Guard<GitTarget> = isGitTarget
export const residentIdArg: Guard<string> = (v): v is string => typeof v === 'string' && RESIDENT_ID_RE.test(v)
export const residentKindArg: Guard<ResidentKindId> = isResidentKindId
export const residentTextArg: Guard<string> = (v): v is string => typeof v === 'string' && v.length <= 8000
/** A permission request id (claude's), a quick action's id or an option key: short, printable, no path. */
export const residentTokenArg: Guard<string> = (v): v is string => typeof v === 'string' && /^[\w.:-]{1,200}$/.test(v)

export type ChatStartOptions = { takeOver: boolean; model?: ChatModel; permissionMode?: ChatPermissionMode; effort?: ChatEffort }
export const chatStartOptions: Guard<ChatStartOptions> = (v): v is ChatStartOptions => {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.takeOver === 'boolean'
    && (o.model === undefined || isChatModel(o.model))
    && (o.permissionMode === undefined || isChatPermissionMode(o.permissionMode))
    && (o.effort === undefined || isChatEffort(o.effort))
}
export const chatDecisionArg: Guard<ChatDecision> = isChatDecision
export const chatModelArg: Guard<ChatModel> = isChatModel
export const chatModeArg: Guard<ChatPermissionMode> = isChatPermissionMode
export const chatEffortArg: Guard<ChatEffort> = isChatEffort

export const point: Guard<{ x: number; y: number }> = (v): v is { x: number; y: number } =>
  typeof v === 'object' && v !== null
  && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number'

/** A side question's earlier exchange (`chatAside`): two strings, checked element by element. */
export const isAsideTurn: Guard<AsideTurn> = (v): v is AsideTurn =>
  typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).question === 'string'
  && typeof (v as Record<string, unknown>).answer === 'string'

/** A malformed array from a stale renderer would crash `tabs.map` in main, so every element is checked. */
export const isReportedTab: Guard<ReportedTab> = (v): v is ReportedTab => {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  return typeof t.key === 'string'
    && (t.view === 'transcript' || t.view === 'terminal')
    && (t.ptyId === null || typeof t.ptyId === 'string')
    && (t.label === null || typeof t.label === 'string')
}

/** An object naming no `screen` setting: how a window's own screen looks is never another machine's to store. */
export const machineSettingsPatch: Guard<Record<string, unknown>> = (v): v is Record<string, unknown> =>
  isRecord(v) && Object.keys(v).every((k) => !SCREEN_SETTING_KEYS.has(k as SettingKey))
