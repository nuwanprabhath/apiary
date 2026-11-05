import { describe, it, expect } from 'vitest'
import { installService, serviceUnitText, uninstallService, unitPath, type ServiceDeps } from '../../src/main/update/backgroundService'
import { relaunchCommand, type Command } from '../../src/main/update/installCommands'

function deps(over: Partial<ServiceDeps> & { codes?: (c: Command) => number } = {}) {
  const files = new Map<string, string>()
  const ran: Command[] = []
  const said: string[] = []
  const d: ServiceDeps = {
    execPath: '/opt/Apiary/apiary',
    leadingArgs: [],
    homeDir: '/home/me',
    remoteAccessOn: true,
    writeFile: (path, text) => { files.set(path, text) },
    removeFile: (path) => { files.delete(path) },
    run: (c) => { ran.push(c); return over.codes?.(c) ?? 0 },
    out: (t) => { said.push(t) },
    ...over,
  }
  return { d, files, ran, said: () => said.join('') }
}

const line = (c: Command): string => [c.file, ...c.args].join(' ')

describe('the Apiary background service', () => {
  it('the unit runs Apiary in the background at boot and brings it back from a crash only', () => {
    const unit = serviceUnitText('/opt/Apiary/apiary')
    expect(unit).toContain('ExecStart="/opt/Apiary/apiary" --background')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('WantedBy=default.target')
    expect(serviceUnitText('/app/electron', ['/app'])).toContain('ExecStart="/app/electron" "/app" --background')
  })

  it('installs: writes the unit, reloads, enables and starts it, then turns on linger so it outlives a logout', () => {
    const w = deps()
    expect(installService(w.d)).toBe(0)
    expect([...w.files.keys()]).toEqual(['/home/me/.config/systemd/user/apiary.service'])
    expect(w.ran.map(line)).toEqual([
      'systemctl --user daemon-reload',
      'systemctl --user enable --now apiary.service',
      'loginctl enable-linger',
    ])
    expect(w.said()).toContain('Linger is on')
  })

  it('refuses with remote access off, which would leave a background Apiary nothing to do', () => {
    const w = deps({ remoteAccessOn: false })
    expect(installService(w.d)).toBe(1)
    expect(w.files.size).toBe(0)
    expect(w.ran).toEqual([])
    expect(w.said()).toContain('Allow remote access over SSH')
  })

  it('says how to keep it when linger cannot be turned on, and still counts as installed', () => {
    const w = deps({ codes: (c) => (c.file === 'loginctl' ? 1 : 0) })
    expect(installService(w.d)).toBe(0)
    expect(w.said()).toContain('sudo loginctl enable-linger $USER')
  })

  it('fails when systemctl cannot start it, before asking for linger', () => {
    const w = deps({ codes: (c) => (c.args.includes('enable') ? 1 : 0) })
    expect(installService(w.d)).toBe(1)
    expect(w.ran.map((c) => c.file)).not.toContain('loginctl')
  })

  it('uninstalls: stops, disables and removes the unit', () => {
    const w = deps()
    w.files.set(unitPath('/home/me'), 'x')
    expect(uninstallService(w.d)).toBe(0)
    expect(w.files.size).toBe(0)
    expect(w.ran.map(line)).toEqual(['systemctl --user disable --now apiary.service', 'systemctl --user daemon-reload'])
  })

  it('an update restarts the service through systemd rather than starting a second Apiary beside it', () => {
    expect(relaunchCommand({ pid: 9, binary: '/opt/Apiary/apiary', args: ['--background'], env: {}, unit: 'apiary.service' }))
      .toEqual({ file: 'systemctl', args: ['--user', 'restart', '--no-block', 'apiary.service'] })
    expect(relaunchCommand({ pid: 9, binary: '/opt/Apiary/apiary', args: [], env: {}, unit: 'run-u12.service' }).file).toBe('systemd-run')
  })
})
