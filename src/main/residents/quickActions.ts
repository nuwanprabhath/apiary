/** What `{option:<key>}` and `{bin:<name>}` in a command's argv read from. */
export interface ArgvContext {
  options: Readonly<Record<string, string>>
  bins: Readonly<Record<string, () => string[]>>
}

const OPTION_RE = /\{option:([a-zA-Z0-9_-]+)\}/g
const BIN_RE = /^\{bin:([a-zA-Z0-9_-]+)\}$/

/**
 * A quick action's argv with its placeholders filled. `{bin:<name>}` is a whole argument and
 * becomes the kind's argv prefix (`python3 <script>`); `{option:<key>}` is replaced inside any
 * argument by the resident's option. Each value stays one argument (execFile, no shell). Throws,
 * with what to set, for an unknown bin or an option that is empty.
 */
export function expandArgv(argv: readonly string[], ctx: ArgvContext): string[] {
  const out: string[] = []
  for (const arg of argv) {
    const bin = BIN_RE.exec(arg)
    if (bin !== null) {
      const prefix = Object.hasOwn(ctx.bins, bin[1]) ? ctx.bins[bin[1]]() : []
      if (prefix.length === 0) throw new Error(`Unknown program: ${bin[1]}`)
      out.push(...prefix)
      continue
    }
    out.push(arg.replace(OPTION_RE, (_m, key: string) => {
      const value = Object.hasOwn(ctx.options, key) ? ctx.options[key].trim() : ''
      if (value === '') throw new Error(`Set "${key}" in Settings first`)
      return value
    }))
  }
  if (out.length === 0) throw new Error('The action has no command')
  return out
}

/** Why a cycle prompt is not sent now, or null when it is due to go. */
export type CycleSkip = 'off duty' | 'busy' | 'permission waiting' | 'setup needed' | null

export function cycleSkip(state: {
  enabled: boolean; onDuty: boolean; busy: boolean; permissionsWaiting: number; setupNeeded: string | null
}): CycleSkip {
  if (!state.enabled || !state.onDuty) return 'off duty'
  if (state.busy) return 'busy'
  if (state.permissionsWaiting > 0) return 'permission waiting'
  if (state.setupNeeded !== null) return 'setup needed'
  return null
}
