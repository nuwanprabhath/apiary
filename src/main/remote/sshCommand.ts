/**
 * What `ssh` is asked to do for a remote connection, and what its complaints mean. Pure, so a test
 * can pin the exact argv: it is the man-in-the-middle defence (`StrictHostKeyChecking=yes` is never
 * relaxed, and `--` keeps a host from ever being read as an option).
 */

/** Always passed: no prompt of any kind (the app has no terminal), a known host key, a bounded connect. */
function baseOptions(sshConfig: string | undefined, connectTimeoutSeconds = 10): string[] {
  return [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `ConnectTimeout=${String(connectTimeoutSeconds)}`,
    ...(sshConfig !== undefined ? ['-F', sshConfig] : []),
  ]
}

/** Asks the work machine for its home directory; the remote shell expands `$HOME`. */
export function homeDirArgs(host: string, sshConfig: string | undefined): string[] {
  return [...baseOptions(sshConfig), '--', host, 'printf', '%s', '$HOME']
}

/**
 * One fixed script, with nothing a person typed in it. `ready`: the socket is there. `off`: Apiary
 * runs but has no socket (remote access is off). `stopped`: no Apiary process (`-x`, an exact name:
 * a `-f` match would find this very script). Sent as one `sh -c` word, so the user's remote login
 * shell, whatever it is, only has to run `sh`.
 */
const PROBE_SCRIPT = 'if test -S "$HOME/.apiary/remote.sock"; then echo ready; '
  + 'elif pgrep -x Apiary >/dev/null 2>&1 || pgrep -x apiary >/dev/null 2>&1; then echo off; '
  + 'else echo stopped; fi'

/**
 * Starts Apiary on the work machine in the background (`--background`: no window, remote server
 * only). macOS: `open -g` keeps it from taking the focus. Elsewhere: `systemd-run --user`, so it
 * lives in the user's systemd session, which has the desktop's display when someone is logged in.
 * Fixed, like the probe.
 */
const START_SCRIPT = 'if [ "$(uname -s)" = Darwin ]; then open -g -a Apiary --args --background; '
  + 'else systemd-run --user --collect apiary --background; fi'

/**
 * Asks what `host` has: `ready`, `off` or `stopped` on stdout when ssh got in. The options are the
 * usual ones (no prompt, a known host key), so a probe never trusts a new host; the connect wait is
 * short because a probe only asks. A failed ssh is told from an answer by what is printed.
 */
export function probeArgs(host: string, sshConfig: string | undefined): string[] {
  return [...baseOptions(sshConfig, 3), '--', host, `sh -c '${PROBE_SCRIPT}'`]
}

/** Starts Apiary in the background on `host`; see `START_SCRIPT`. */
export function startAppArgs(host: string, sshConfig: string | undefined): string[] {
  return [...baseOptions(sshConfig), '--', host, `sh -c '${START_SCRIPT}'`]
}

/** Forwards `localSocket` to the work machine's Apiary socket. The host goes after `--`, as the positional. */
export function forwardFlags(localSocket: string, remoteSocket: string, sshConfig: string | undefined): string[] {
  return [
    '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
    ...baseOptions(sshConfig), '-L', `${localSocket}:${remoteSocket}`,
  ]
}

/** Tailscale SSH's refusal of a user its tailnet policy does not allow, with the user it names. */
const TAILSCALE_REFUSAL = /tailnet policy does not permit you to SSH(?: as user "([^"]*)")?/

/**
 * Whether ssh reached the machine and was refused the login (a key it does not take, or a user
 * Tailscale's policy does not allow), as opposed to not reaching it at all. The connect dialog
 * says "login refused" rather than "unreachable": the fix is a user or a key, not the network.
 */
export function isLoginRefused(stderr: string): boolean {
  return stderr.includes('Permission denied') || TAILSCALE_REFUSAL.test(stderr)
}

/** ssh's stderr as a sentence a person can act on. */
export function describeSshFailure(stderr: string, host: string, timedOut = false): string {
  if (timedOut) return `${host} did not answer.`
  const tailscale = TAILSCALE_REFUSAL.exec(stderr)
  if (tailscale !== null) {
    // Tailscale SSH logs in as a user of the work machine; with no user given, ssh sends this
    // computer's own user name, which the work machine rarely has.
    const machine = host.slice(host.lastIndexOf('@') + 1)
    const as = tailscale[1] !== undefined && tailscale[1] !== '' ? ` as "${tailscale[1]}"` : ''
    return `Tailscale reached ${machine} but its tailnet policy does not let you log in${as}. Connect as a user that machine has: type user@${machine}, or add a "User" line for ${machine} to ~/.ssh/config.`
  }
  if (stderr.includes('Host key verification failed')) {
    return `${host}'s identity is not trusted yet, or it has changed. Run \`ssh ${host}\` once in a terminal, check the fingerprint, and accept it. Then connect again.`
  }
  if (stderr.includes('Permission denied')) {
    return `SSH refused the login to ${host}. Apiary uses your SSH keys and agent; check that \`ssh ${host}\` works without a password prompt.`
  }
  if (stderr.includes('Could not resolve hostname')) return `No machine called ${host} was found.`
  const first = stderr.split('\n').map((l) => l.trim()).find((l) => l !== '')
  return first ?? `Could not connect to ${host} over SSH.`
}
