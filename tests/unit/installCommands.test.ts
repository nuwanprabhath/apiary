import { describe, it, expect } from 'vitest'
import {
  bundleFromExecPath, debInstallCommand, isPasswordRefusal, macInstallScript, relaunchArgs, relaunchCommand,
  relaunchEnv, systemdUserUnit, SUDO_PROBE, SUDO_VALIDATE,
} from '../../src/main/update/installCommands'

describe('the .deb install command', () => {
  it('runs apt-get under sudo reading the password from stdin, never caching it, with no prompt', () => {
    const cmd = debInstallCommand("/home/dev/Down loads/apiary_1.51.0_arm64.deb", true)
    expect(cmd.file).toBe('sudo')
    expect(cmd.args).toEqual(['-S', '-k', '-p', '', 'apt-get', 'install', '-y', '--allow-downgrades', '/home/dev/Down loads/apiary_1.51.0_arm64.deb'])
    expect(cmd.env).toEqual({ DEBIAN_FRONTEND: 'noninteractive' })
    expect(SUDO_PROBE).toEqual({ file: 'sudo', args: ['-n', 'true'] })
    expect(SUDO_VALIDATE.args).toEqual(['-S', '-k', '-p', '', '-v'])
  })

  it('with no password, runs apt-get under sudo -n, so a cached or NOPASSWD sudo never reads stdin', () => {
    expect(debInstallCommand('/tmp/a.deb', false).args).toEqual(['-n', 'apt-get', 'install', '-y', '--allow-downgrades', '/tmp/a.deb'])
  })

  it('tells a refused password from a failed install by sudo\'s exit and stderr only', () => {
    expect(isPasswordRefusal(1, 'Sorry, try again.\nsudo: 1 incorrect password attempt\n')).toBe(true)
    expect(isPasswordRefusal(1, 'sudo: no password was provided\n')).toBe(true)
    expect(isPasswordRefusal(100, 'E: Sorry, try again later')).toBe(false)
    expect(isPasswordRefusal(1, 'E: dpkg was interrupted')).toBe(false)
  })
})

describe('/proc/self/cgroup', () => {
  it('finds the transient unit systemd-run --user made', () => {
    expect(systemdUserUnit('0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-u12.service\n')).toBe('run-u12.service')
  })
  it('finds a named unit', () => {
    expect(systemdUserUnit('0::/user.slice/user-1000.slice/user@1000.service/app.slice/apiary.service')).toBe('apiary.service')
  })
  it('is null outside the user manager: a login session scope, a container, nothing', () => {
    expect(systemdUserUnit('0::/user.slice/user-1000.slice/session-3.scope\n')).toBeNull()
    expect(systemdUserUnit('0::/\n')).toBeNull()
    expect(systemdUserUnit('')).toBeNull()
  })
})

describe('the relaunch', () => {
  const base = { pid: 4242, binary: '/opt/Apiary/apiary', args: ['--no-sandbox', 'a b'], env: { DISPLAY: ':99', APIARY_X: 'it\'s' } }

  it('under a systemd user unit starts a new transient unit with the GUI env, which waits for the old pid', () => {
    const cmd = relaunchCommand({ ...base, unit: 'run-u12.service' })
    expect(cmd.file).toBe('systemd-run')
    expect(cmd.args.slice(0, 3)).toEqual(['--user', '--collect', '--quiet'])
    expect(cmd.args).toContain('--setenv=DISPLAY=:99')
    expect(cmd.args).toContain('--setenv=APIARY_X=it\'s')
    const sh = cmd.args.indexOf('/bin/sh')
    expect(cmd.args.slice(sh + 3)).toEqual(['apiary-relaunch', '4242', '/opt/Apiary/apiary', '--no-sandbox', 'a b'])
    expect(cmd.args[sh + 2]).toContain('kill -0 "$1"')
    expect(cmd.args[sh + 2]).toContain('exec "$@"')
  })

  it('otherwise is a setsid helper in its own session', () => {
    const cmd = relaunchCommand({ ...base, unit: null })
    expect(cmd.file).toBe('setsid')
    expect(cmd.args.slice(0, 3)).toEqual(['-f', '/bin/sh', '-c'])
    expect(cmd.args.some((a) => a.startsWith('--setenv'))).toBe(false)
  })

  it('passes the display, bus and APIARY_ variables through, and nothing else', () => {
    expect(relaunchEnv({
      DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/x', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/b', XDG_RUNTIME_DIR: '/run/user/1000',
      APIARY_FAKE_UPDATE: '1.51.1', HOME: '/home/dev', SECRET_TOKEN: 't', PATH: '/bin', UNSET: undefined,
    })).toEqual({
      DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/x', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/b', XDG_RUNTIME_DIR: '/run/user/1000',
      APIARY_FAKE_UPDATE: '1.51.1',
    })
  })

  it('keeps the original arguments, without the binary', () => {
    expect(relaunchArgs(['/opt/Apiary/apiary', '--no-sandbox', '--safe-theme'])).toEqual(['--no-sandbox', '--safe-theme'])
  })

  it('keeps --user-data-dir, which the person (or the test bed\'s shim) passed to the main process', () => {
    expect(relaunchArgs(['/opt/Apiary/apiary', '--user-data-dir=/x', '--no-sandbox'])).toEqual(['--user-data-dir=/x', '--no-sandbox'])
  })
})

describe('the macOS install helper', () => {
  it('finds the running bundle wherever it is, not only in /Applications', () => {
    expect(bundleFromExecPath('/Users/me/Apps/Apiary.app/Contents/MacOS/Apiary')).toBe('/Users/me/Apps/Apiary.app')
    expect(bundleFromExecPath('/usr/local/bin/electron')).toBeNull()
  })

  const script = macInstallScript({
    pid: 77, dmg: "/Users/o'brien/Downloads/Apiary 1.51.0.dmg", bundle: '/Applications/Apiary.app',
    resultFile: '/Users/o\'brien/Library/Application Support/Apiary/update-result.json', version: '1.51.0', uid: 501,
  })

  it('quotes every path for the shell', () => {
    expect(script).toContain(`dmg='/Users/o'\\''brien/Downloads/Apiary 1.51.0.dmg'`)
    expect(script).toContain(`result='/Users/o'\\''brien/Library/Application Support/Apiary/update-result.json'`)
    expect(script).toContain(`app='/Applications/Apiary.app'`)
  })

  it('waits for the old pid with a bound, swaps the bundle in with a way back, clears quarantine, and deletes the .dmg only on success', () => {
    expect(script).toContain('while kill -0 "$pid"')
    expect(script).toContain('[ "$i" -ge 300 ]')
    expect(script).toMatch(/hdiutil attach -nobrowse -quiet .*-mountpoint "\$mnt" "\$dmg"/)
    expect(script).toContain('ditto "$new" "$stage"')
    expect(script).toContain('if ! mv "$stage" "$app"; then mv "$old" "$app"')
    expect(script).toContain('xattr -cr "$app"')
    expect(script.indexOf('rm -f "$dmg"')).toBeGreaterThan(script.indexOf('xattr -cr "$app"'))
    expect(script.indexOf('rm -f "$dmg"')).toBeLessThan(script.indexOf('report true'))
  })

  it('relaunches as the logged-in user when it ran under sudo', () => {
    expect(script).toContain(`launchctl asuser 501 sudo -u '#501' open -n "$app"`)
  })
})
