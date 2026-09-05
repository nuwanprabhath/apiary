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
