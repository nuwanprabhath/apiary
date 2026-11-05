import { join } from 'node:path'
import { SERVICE_UNIT, type Command } from './installCommands'

/**
 * The unit: Apiary in the background, which on a machine with nobody at the desktop starts with no
 * display (`needsNoDisplay`). `default.target` with linger starts it at boot and keeps it through a
 * logout; `on-failure` brings it back from a crash but not from a quit or an update's SIGTERM.
 */
export function serviceUnitText(execPath: string, leadingArgs: readonly string[] = []): string {
  return [
    '# Written by `apiary --install-service`; `apiary --uninstall-service` removes it.',
    '[Unit]',
    'Description=Apiary in the background, for remote windows and the desktop to join',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${[execPath, ...leadingArgs].map((w) => `"${w}"`).join(' ')} --background`,
    'Restart=on-failure',
    'RestartSec=10',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

export interface ServiceDeps {
  execPath: string
  /** What goes before `--background`: the app folder when run from source (`electron <app>`), nothing when packaged. */
  leadingArgs: string[]
  homeDir: string
  /** The settings say remote access is on: with it off, a background Apiary has nothing to serve and quits. */
  remoteAccessOn: boolean
  writeFile: (path: string, text: string) => void
  removeFile: (path: string) => void
  /** Runs a command attached to the terminal; its exit code. */
  run: (command: Command) => number
  out: (text: string) => void
}

export const unitPath = (homeDir: string): string => join(homeDir, '.config', 'systemd', 'user', SERVICE_UNIT)

const systemctl = (...args: string[]): Command => ({ file: 'systemctl', args: ['--user', ...args] })

/**
 * `apiary --install-service`: writes the unit, enables and starts it, and turns on linger (systemd
 * keeps a user's services running with no session open, and starts them at boot), which polkit may
 * ask the password for. Each step says what failed; linger failing still leaves the service running
 * while someone is logged in. Linux with systemd only.
 */
export function installService(deps: ServiceDeps): number {
  const { out } = deps
  if (!deps.remoteAccessOn) {
    out('Remote access is off, so a background Apiary would have nothing to do and quit. Turn on Settings → General → Allow remote access over SSH, then run this again.\n')
    return 1
  }
  const path = unitPath(deps.homeDir)
  deps.writeFile(path, serviceUnitText(deps.execPath, deps.leadingArgs))
  out(`Wrote ${path}.\n`)
  if (deps.run(systemctl('daemon-reload')) !== 0 || deps.run(systemctl('enable', '--now', SERVICE_UNIT)) !== 0) {
    out('systemctl could not start it. Is there a systemd user session? (`systemctl --user status`)\n')
    return 1
  }
  out('Apiary is running in the background as a systemd user service, and starts when the machine does.\n')
  if (deps.run({ file: 'loginctl', args: ['enable-linger'] }) !== 0) {
    out('Could not turn on linger, so it stops when your last session ends. Run `sudo loginctl enable-linger $USER` to keep it.\n')
    return 0
  }
  out('Linger is on: it keeps running after you log out.\n')
  return 0
}

/** `apiary --uninstall-service`: stops and disables the service and removes its unit. Linger is left as it is. */
export function uninstallService(deps: ServiceDeps): number {
  deps.run(systemctl('disable', '--now', SERVICE_UNIT))
  deps.removeFile(unitPath(deps.homeDir))
  deps.run(systemctl('daemon-reload'))
  deps.out('Removed the Apiary service. Apiary no longer starts by itself.\n')
  return 0
}
