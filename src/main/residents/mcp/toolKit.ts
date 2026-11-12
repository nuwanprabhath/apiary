import { isRecord } from '@shared/guards'
import type { SessionId } from '@shared/domain/ids'
import type { ResidentAttention } from '@shared/domain/residents'
import type { SessionKnowledge } from '../../knowledge/types'
import type { ResidentCapability } from '../kinds'
import type { ResidentApproval, ResidentUserActions } from '../kindTypes'
import type { ResidentSpace } from '../residentSpace'

/** What a tool answers: text for the model, and whether it is an error the model should see as one. */
export interface ToolResult {
  text: string
  isError: boolean
}

/** What the tools reach in Apiary. Ids only: no tool takes or returns a filesystem path. */
export interface ToolDeps {
  /** Null until the knowledge index is wired in; the session tools then say so. */
  knowledge: SessionKnowledge | null
  /** A session Apiary knows (in the session store, not deleted), by id; null for any other id. */
  session(id: string): { title: string } | null
  /** Asks the windows to show the session (`openSessionRequested`). */
  openSession(id: SessionId): void
  /** Every open tab, as the windows last reported them, and the window in front. */
  openTabs(): { windowNumber: number; key: string; view: string; label: string | null }[]
  focusedWindow(): number | null
  /** The residents themselves, for the one the token names. */
  residents: ResidentControl
  /** Absent where nothing approves (a test of other tools): `approve_mr` and `request_user_action` then say so. */
  approval?: ApprovalControl
}

/** What the status and attention tools do to the calling resident. */
export interface ResidentControl {
  /** The `apiary_status` answer for this resident. */
  statusText(residentId: string): string
  /** Sets (or, with null, clears) what it needs the user for; it persists until the user opens its popup. */
  setAttention(residentId: string, attention: ResidentAttention | null): void
  /** Its own words for the pill, until the next tool call or the turn's end. */
  setActivity(residentId: string, text: string): void
}

/** What `approve_mr` and `request_user_action` reach for the resident the token names. */
export interface ApprovalControl {
  /** Its kind's approval, or null for a kind without one. */
  approvalOf(residentId: string): ResidentApproval | null
  /** Its kind's user actions, or null for a kind without them. */
  userActionsOf(residentId: string): ResidentUserActions | null
  /** Whether it may act on MR `iid` without a card: its "Ask before acting" option is off and the
   *  user named that MR in its chat. */
  actsUnasked(residentId: string, iid: number): boolean
  /** Shows the user a permission card with main's summary; resolves with their answer. */
  askUser(residentId: string, tool: string, summary: string): Promise<boolean>
  /** Runs a kind argv (`{bin:<name>}` expanded) in its space with its env plus `extraEnv`; resolves with stdout. */
  run(residentId: string, argv: string[], extraEnv: Record<string, string>): Promise<string>
  /** Its space folder, where the kind's nonce file goes. */
  spaceDir(residentId: string): string
}

/** Who is calling: the resident the bearer token belongs to. */
export interface ToolCall {
  residentId: string
  space: ResidentSpace
}

/** A tool as the server sees it: its listing, and a call that validates its arguments first. */
export interface Tool {
  name: string
  capability: ResidentCapability
  description: string
  inputSchema: Record<string, unknown>
  call: (args: unknown, call: ToolCall, deps: ToolDeps) => Promise<ToolResult>
}

interface ToolSpec<A> extends Omit<Tool, 'call'> {
  /** Returns the arguments if they are valid, else a sentence saying what is wrong. */
  parse: (args: Record<string, unknown>) => A | string
  run: (args: A, call: ToolCall, deps: ToolDeps) => Promise<ToolResult> | ToolResult
}

export function tool<A>(spec: ToolSpec<A>): Tool {
  const { parse, run, ...listing } = spec
  return {
    ...listing,
    call: async (args, call, deps) => {
      const parsed = parse(isRecord(args) ? args : {})
      if (typeof parsed === 'string') return fail(parsed)
      return run(parsed, call, deps)
    },
  }
}

export const ok = (text: string): ToolResult => ({ text, isError: false })
export const fail = (text: string): ToolResult => ({ text, isError: true })

export const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null)
export const intIn = (v: unknown, min: number, max: number): number | null =>
  (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null)
