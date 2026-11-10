import { shellQuote } from '../exec/shellQuote'

/** The user unit `apiary --install-service` writes (`backgroundService.ts`); `relaunchCommand` restarts it. */
export const SERVICE_UNIT = 'apiary.service'

/**
 * The commands and scripts Install and restart runs, as pure functions of what main already holds
 * (the verified installer's path, this process's pid, argv and env), so every quoting and every
 * branch is tested without running any of them. None of them ever carries the password: it reaches
 * only sudo's stdin.
 */

export interface Command {
  file: string
  args: string[]
}

/** `sudo -n true`: exits 0 when sudo would not ask for a password (NOPASSWD, or still cached). */
export const SUDO_PROBE: Command = { file: 'sudo', args: ['-n', 'true'] }

/** sudo reading the password from stdin, never cached (`-k`), with no prompt text on stderr. */
const SUDO_STDIN = ['-S', '-k', '-p', '']

/** `args` run as root, with the password read from stdin. */
export function sudoWithStdin(args: string[]): Command {
  return { file: 'sudo', args: [...SUDO_STDIN, ...args] }
}

/** Checks a password without running anything (`-v`), so a wrong one is known before quitting. */
export const SUDO_VALIDATE: Command = sudoWithStdin(['-v'])

/**
 * Installs a verified `.deb` while Apiary is still running; `DEBIAN_FRONTEND` keeps apt from asking.
 * With no password it runs under `sudo -n`, which uses a NOPASSWD rule or a cached credential and
 * reads nothing; `-S -k` would discard that cache and read an empty password.
 */
export function debInstallCommand(debPath: string, withPassword: boolean): Command & { env: Record<string, string> } {
  const apt = ['apt-get', 'install', '-y', '--allow-downgrades', debPath]
  return {
    ...(withPassword ? sudoWithStdin(apt) : { file: 'sudo', args: ['-n', ...apt] }),
    env: { DEBIAN_FRONTEND: 'noninteractive' },
  }
}

/**
 * Whether a failed `sudo -S` was sudo refusing the password rather than the command it ran failing.
 * sudo exits 1 and says so on stderr; apt-get exits 100. Only that one distinction is read.
 */
export function isPasswordRefusal(exitCode: number | null, stderr: string): boolean {
  return exitCode === 1 && /incorrect password|Sorry, try again|no password was provided|a password is required/i.test(stderr)
}

/**
 * The systemd user unit this process runs in, from `/proc/self/cgroup` (cgroup v2: `0::/user.slice/
 * user-1000.slice/user@1000.service/app.slice/run-u12.service`), or null when it is not under the
 * user manager. `systemd-run --user --collect` gives a transient `run-*.service`; a named unit works too.
 */
export function systemdUserUnit(cgroup: string): string | null {
  for (const line of cgroup.split('\n')) {
    const path = line.split(':').slice(2).join(':')
    const parts = path.split('/')
    const manager = parts.findIndex((p) => /^user@\d+\.service$/.test(p))
    if (manager === -1) continue
    const unit = parts.slice(manager + 1).reverse().find((p) => /\.(service|scope)$/.test(p))
    if (unit !== undefined) return unit
  }
  return null
}

/** The variables a GUI app needs to reach the display and session bus, plus every `APIARY_*`. */
const PASSED_THROUGH = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR']

export function relaunchEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (PASSED_THROUGH.includes(key) || key.startsWith('APIARY_')) out[key] = value
  }
  return out
}

/**
 * The arguments the new instance gets: exactly the ones this main process was started with.
 * Chromium adds its internal switches (`--type=`, `--field-trial-handle=`) only to child processes,
 * never to the main process's argv, so nothing is filtered.
 */
export function relaunchArgs(argv: readonly string[]): string[] {
  return argv.slice(1)
}

/**
 * Waits (up to about 60 s) for `$1`, the old pid, to exit, then `exec`s the rest of its arguments:
 * the single-instance lock is the old process's until then. Positional, so nothing is quoted.
 */
const WAIT_THEN_EXEC = 'i=0; while kill -0 "$1" 2>/dev/null; do i=$((i+1)); [ "$i" -ge 300 ] && exit 1; sleep 0.2; done; shift; exec "$@"'

export interface RelaunchInput {
  pid: number
  /** The installed binary, which apt replaced in place (`/opt/Apiary/apiary`). */
  binary: string
  args: string[]
  env: Record<string, string>
  /** From `systemdUserUnit`: null when Apiary was not started under the systemd user manager. */
  unit: string | null
}

/**
 * Starts the new instance so that it outlives this one. Under a systemd user unit, a plain child is
 * killed with the old unit's cgroup when it stops, so the new instance gets a transient unit of its
 * own; otherwise a `setsid` helper in its own session is enough.
 */
export function relaunchCommand(input: RelaunchInput): Command {
  // The installed service is restarted by systemd, which stops this one and keeps managing the new one.
  if (input.unit === SERVICE_UNIT) return { file: 'systemctl', args: ['--user', 'restart', '--no-block', SERVICE_UNIT] }
  const tail = ['/bin/sh', '-c', WAIT_THEN_EXEC, 'apiary-relaunch', String(input.pid), input.binary, ...input.args]
  if (input.unit === null) return { file: 'setsid', args: ['-f', ...tail] }
  const setenv = Object.entries(input.env).map(([k, v]) => `--setenv=${k}=${v}`)
  return { file: 'systemd-run', args: ['--user', '--collect', '--quiet', ...setenv, ...tail] }
}

/**
 * Starts Apiary with nothing to wait for (the command-line update with `--background`, when none
 * runs): under the user's systemd (`systemd: true`, a transient unit of its own, as the remote start
 * does), or in a session of its own (`setsid -f`) where there is no user systemd to ask.
 */
export function startCommand(input: { binary: string; args: string[]; env: Record<string, string>; systemd: boolean }): Command {
  if (!input.systemd) return { file: 'setsid', args: ['-f', input.binary, ...input.args] }
  const setenv = Object.entries(input.env).map(([k, v]) => `--setenv=${k}=${v}`)
  return { file: 'systemd-run', args: ['--user', '--collect', '--quiet', ...setenv, input.binary, ...input.args] }
}

/** The running `.app` bundle, from `process.execPath` (`…/Apiary.app/Contents/MacOS/Apiary`); never assumed to be in /Applications. */
export function bundleFromExecPath(execPath: string): string | null {
  const match = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)
  return match?.[1] ?? null
}

export interface MacScriptInput {
  pid: number
  dmg: string
  bundle: string
  /** `update-result.json` under userData: the next start reads it and deletes it. */
  resultFile: string
  version: string
  /** The logged-in user, so a helper running under sudo relaunches Apiary as them, not as root. */
  uid: number
  /** Replaces the relaunch, for the integration test, which must not open anything. */
  relaunch?: string
}

/**
 * The helper that installs a verified `.dmg` after Apiary has quit (a running bundle must not be
 * replaced). It swaps the new bundle in beside the old one on the same volume, so a failure part way
 * puts the old one back; clears the quarantine on the installed bundle; deletes the .dmg only on
 * success; writes a one-line result for the next start; and relaunches as the logged-in user.
 */
export function macInstallScript(input: MacScriptInput): string {
  const q = shellQuote
  const relaunch = input.relaunch
    ?? `if [ "$(id -u)" -eq 0 ]; then launchctl asuser ${String(input.uid)} sudo -u '#${String(input.uid)}' open -n "$app"; else open -n "$app"; fi`
  return `#!/bin/sh
pid=${String(input.pid)}
dmg=${q(input.dmg)}
app=${q(input.bundle)}
result=${q(input.resultFile)}
version_json=${q(JSON.stringify(input.version))}
dmg_json=${q(JSON.stringify(input.dmg))}
uid=${String(input.uid)}
parent=$(dirname "$app")
stage="$parent/.apiary-update-$$.app"
old="$parent/.apiary-old-$$.app"
mnt=""

relaunch() { ${relaunch}; }
report() {
  printf '{"version":%s,"ok":%s,"message":"%s","path":%s}\\n' "$version_json" "$1" "$2" "$dmg_json" > "$result"
  [ "$(id -u)" -eq 0 ] && chown "$uid" "$result"
}
detach() { [ -n "$mnt" ] && { hdiutil detach "$mnt" -quiet || hdiutil detach "$mnt" -quiet -force; rmdir "$mnt"; }; mnt=""; }
fail() { rm -rf "$stage"; detach; report false "$1"; relaunch; rm -rf "$(dirname "$0")"; exit 1; }

i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); [ "$i" -ge 300 ] && { report false "Apiary did not quit in time, so the update was not installed."; rm -rf "$(dirname "$0")"; exit 1; }
  sleep 0.2
done

mnt=$(mktemp -d) || fail "Could not make a folder to open the disk image in."
hdiutil attach -nobrowse -quiet -noverify -mountpoint "$mnt" "$dmg" || { rmdir "$mnt"; mnt=""; fail "The disk image could not be opened."; }
new=""
for a in "$mnt"/*.app; do [ -d "$a" ] && { new=$a; break; }; done
[ -n "$new" ] || fail "The disk image holds no app."
ditto "$new" "$stage" || fail "The new version could not be copied out of the disk image."
detach
mv "$app" "$old" || fail "The installed version could not be moved aside."
if ! mv "$stage" "$app"; then mv "$old" "$app"; fail "The new version could not be moved into place."; fi
rm -rf "$old"
xattr -cr "$app"
rm -f "$dmg"
report true ""
relaunch
rm -rf "$(dirname "$0")"
`
}
