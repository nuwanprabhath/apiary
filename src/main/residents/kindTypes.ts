import type { ResidentAppearance, ResidentConfig, ResidentKindId, ResidentOptionField } from '@shared/domain/residents'

/** A group of Apiary tools (`mcp/tools.ts`). A kind's token sees only the groups it declares. */
export type ResidentCapability =
  | 'sessions.read' | 'workspace.read' | 'workspace.open' | 'space.notes' | 'apiary.status' | 'resident.attention'
  | 'gitlab.approve'

/**
 * What a quick action does. A prompt is sent to the resident's chat as if typed; a command runs
 * the argv (after `{option:<key>}` and `{bin:<name>}` are expanded, `quickActions.ts`) and its
 * output is added to the chat, with no model involved.
 */
export type ResidentQuickActionRun = { kind: 'prompt'; text: string } | { kind: 'command'; argv: string[] }

/** What the approval card names, read by main from GitLab, never supplied by the agent. */
export interface MrHead {
  title: string
  targetBranch: string
  sha: string
}

/**
 * How main approves an MR for a kind with `gitlab.approve` (`approve_mr`): it reads the MR with
 * `readArgv`, asks the user, then writes a one-call nonce to `nonceFile`, runs `approveArgv` with
 * the nonce in `nonceEnv`, and deletes the file. Argvs may use `{bin:<name>}`.
 */
export interface ResidentApproval {
  readArgv: (iid: number) => string[]
  /** The MR from `readArgv`'s stdout, or null when it is not there. */
  parseHead: (stdout: string) => MrHead | null
  approveArgv: (iid: number) => string[]
  nonceFile: (space: string) => string
  nonceEnv: string
}

export interface ResidentKindQuickAction {
  id: string
  label: string
  /** What the pill says from the click until a prompt's model says more, or while a command runs; at most 40 characters. */
  doing: string
  run: ResidentQuickActionRun
}

/**
 * A kind of resident agent. This is the only place a kind is added: a new one is an entry here
 * (and an id in `RESIDENT_KINDS`), plus any tools of a new capability in `mcp/tools.ts`. The
 * service, the MCP server and the renderer work from these fields alone.
 */
export interface ResidentKind {
  id: ResidentKindId
  /** A new resident's config, less its id. */
  defaults: Omit<ResidentConfig, 'id' | 'kind'>
  /** One line for "Add …" in Settings. */
  blurb: string
  appearance: ResidentAppearance
  capabilities: readonly ResidentCapability[]
  /** Appended to claude's own system prompt; `name` is what the user calls it, `cycleMinutes` how often its cycle runs. */
  systemPrompt: (name: string, cycleMinutes?: number) => string
  /** Whether it drives the background digest (`DigestJob`) while on duty. */
  digests: boolean
  /** Its own settings, stored in `ResidentConfig.options` by key. */
  optionFields: readonly ResidentOptionField[]
  /** Its right-click actions, after the common ones the renderer adds. */
  quickActions: readonly ResidentKindQuickAction[]
  /** What `{bin:<name>}` in a command expands to: an argv prefix. */
  bins: Readonly<Record<string, () => string[]>>
  /** A prompt sent to its chat every `everyMinutes` (or the resident's `cycleEveryMinutes`) while on duty, enabled, idle and set up. */
  cycle?: { everyMinutes: number; prompt: string; doing: string }
  /** Whether a message that looks up a session gets the index's matches at once (`instantMatches.ts`). */
  instantMatches: boolean
  /** What is missing before it can work ("Set the GitLab project in Settings"), or null. Synchronous: it reads what `prepare` last found. */
  setup: (config: ResidentConfig) => string | null
  /**
   * Tools its claude may not use, passed as `--disallowedTools` in every permission mode: what it
   * must never do on its own (a write to GitLab, a push) even when text it read asks for it.
   */
  toolPolicy?: { disallowedTools: readonly string[] }
  /** How `approve_mr` runs; a kind with the `gitlab.approve` capability has one. */
  approval?: ResidentApproval
  /** Extra environment for its claude and its commands. */
  env?: (config: ResidentConfig, space: string) => Record<string, string>
  /**
   * Gets its space and what `setup` reads ready: writes the files its program reads and looks for
   * its binaries. The service runs it when the resident is first seen, when its options change and
   * on each re-check while `setup` still reports something, and starts claude and commands only
   * after it settled. `space` exists. It must not throw for a missing tool; `setup` says so.
   */
  prepare?: (config: ResidentConfig, space: string) => Promise<void>
}
