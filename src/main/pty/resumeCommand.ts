const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** POSIX single-quote escaping for a path that reaches a shell. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Builds the payload passed to `$SHELL -l -c`. The session id is validated as a
 * UUID rather than escaped, so nothing user-controlled can reach the shell.
 */
export function buildResumeCommand(
  sessionId: string,
  opts: { fork?: boolean; claudeBin?: string } = {},
): string {
  if (!UUID.test(sessionId)) throw new Error(`Invalid session id: ${sessionId}`)
  const bin = opts.claudeBin ? shellQuote(opts.claudeBin) : 'claude'
  const fork = opts.fork ? ' --fork-session' : ''
  return `exec ${bin} --resume ${sessionId}${fork}`
}

/**
 * Builds the payload passed to `$SHELL -l -c` for starting a brand-new session (no
 * `--resume`). Shares the same `claudeBin` quoting as `buildResumeCommand` so the setting is
 * honoured identically on both paths.
 */
export function buildNewSessionCommand(opts: { claudeBin?: string } = {}): string {
  const bin = opts.claudeBin ? shellQuote(opts.claudeBin) : 'claude'
  return `exec ${bin}`
}

export function loginShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL && env.SHELL.trim() !== '' ? env.SHELL : '/bin/bash'
}

/**
 * Builds the `$SHELL -l -c` payload for a session in chat mode (`main/chat/`): the same `claude
 * --resume`, speaking JSON lines on stdin/stdout the way the VS Code extension's Agent SDK runs it.
 * The session id is validated as a UUID, and the model and permission mode come from fixed lists,
 * so nothing user-controlled reaches the shell.
 */
export function buildChatCommand(
  sessionId: string,
  opts: { claudeBin?: string; model?: string; permissionMode?: string; effort?: string } = {},
): string {
  if (!UUID.test(sessionId)) throw new Error(`Invalid session id: ${sessionId}`)
  const SAFE = /^[a-zA-Z][a-zA-Z0-9.-]{0,63}$/
  const bin = opts.claudeBin ? shellQuote(opts.claudeBin) : 'claude'
  const flags = [
    '--output-format stream-json', '--verbose', '--input-format stream-json',
    '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool stdio',
  ]
  if (opts.model !== undefined && opts.model !== 'default') {
    // Quoted as well as checked: a model id can carry `[1m]`, which a shell would glob.
    if (!/^[a-zA-Z][a-zA-Z0-9.\-[\]]{0,63}$/.test(opts.model)) throw new Error(`Invalid model: ${opts.model}`)
    flags.push(`--model ${shellQuote(opts.model)}`)
  }
  if (opts.effort !== undefined) {
    if (!SAFE.test(opts.effort)) throw new Error(`Invalid effort: ${opts.effort}`)
    flags.push(`--effort ${opts.effort}`)
  }
  if (opts.permissionMode !== undefined) {
    if (!SAFE.test(opts.permissionMode)) throw new Error(`Invalid permission mode: ${opts.permissionMode}`)
    flags.push(`--permission-mode ${opts.permissionMode}`)
  }
  return `exec ${bin} ${flags.join(' ')} --resume ${sessionId}`
}
