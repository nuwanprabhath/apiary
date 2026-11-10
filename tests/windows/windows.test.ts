import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { run, writeFixtureHome, type Run } from '../remote/harness'

/**
 * Windows come back where they were (`npm run test:windows`), on Ubuntu 26.04's own desktop: GNOME's
 * compositor (mutter) as a Wayland session with two monitors side by side, and XWayland.
 *
 * 1. The built app is launched as from that session. It runs itself again through XWayland
 *    (`needsXWayland`): a Wayland app cannot place its windows.
 * 2. Its two windows are put on different monitors by the window manager, one at a size of its own,
 *    one maximised.
 * 3. It is stopped and started again, and each window must come back on its monitor, at its size,
 *    maximised if it was.
 */
const IMAGE = 'apiary-windows-test'
const LABEL = 'apiary.test-bed=windows'
const REPO = resolve(import.meta.dirname, '../..')
const enabled = process.env.APIARY_WINDOWS_E2E === '1'

let container = ''
let dir = ''
/** A GNOME Wayland session's environment, with XWayland's cookie (`desktop` makes both). */
const SESSION = ['XDG_RUNTIME_DIR=/tmp/xdg-dev', 'XDG_SESSION_TYPE=wayland', 'WAYLAND_DISPLAY=wayland-0', 'DISPLAY=:0', 'XAUTHORITY=/tmp/xdg-dev/xauth']
const sh = (script: string, user = 'dev'): Promise<Run> =>
  run('docker', ['exec', '-u', user, ...SESSION.flatMap((e) => ['-e', e]), container, 'sh', '-c', script], 120_000)

async function must(script: string, user = 'dev'): Promise<string> {
  const r = await sh(script, user)
  if (r.code !== 0) throw new Error(`${script} failed (${String(r.code)}): ${r.stderr}${r.stdout}`)
  return r.stdout.trim()
}

interface Win { id: string; x: number; y: number; width: number; height: number; maximized: boolean }

/**
 * The app's windows, with their X geometry (`xwininfo`) and maximised state. Not `wmctrl -lG`: for
 * a window with static gravity under mutter it reports twice the real position.
 */
async function appWindows(): Promise<Win[]> {
  const ids = (await sh('wmctrl -l')).stdout.split('\n').filter((l) => /Apiary/.test(l)).flatMap((l) => { const id = l.trim().split(/\s+/)[0]; return id === undefined ? [] : [id] })
  return Promise.all(ids.map(async (id): Promise<Win> => {
    const info = (await sh(`xwininfo -id ${id}`)).stdout
    const field = (name: string): number => Number(new RegExp(`${name}:\\s+(-?\\d+)`).exec(info)?.[1] ?? NaN)
    const state = (await sh(`xprop -id ${id} _NET_WM_STATE`)).stdout
    return {
      id, x: field('Absolute upper-left X'), y: field('Absolute upper-left Y'), width: field('Width'), height: field('Height'),
      maximized: /MAXIMIZED_VERT/.test(state) && /MAXIMIZED_HORZ/.test(state),
    }
  }))
}

/** `read` until `ok` says yes; the last value read is in the timeout's message. */
function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, timeoutMs = 30_000): Promise<T> {
  return vi.waitFor(async () => {
    const value = await read()
    if (!ok(value)) throw new Error(`waiting for ${what}: ${JSON.stringify(value)}`)
    return value
  }, { timeout: timeoutMs, interval: 250 })
}

/** Opens the fixture session (writeFixtureHome's) in every window of a layout file. */
const WITH_A_TAB = [
  'const fs = require("fs"), f = process.argv[1], d = JSON.parse(fs.readFileSync(f, "utf8"));',
  'const key = "11111111-1111-4111-8111-111111111111";',
  'for (const w of d.windows) { w.layout.panes[0].tabs = [{ key, view: "transcript", shells: [], activeShell: null }]; w.layout.panes[0].activeTab = key }',
  'fs.writeFileSync(f, JSON.stringify(d))',
].join(' ')

async function launch(): Promise<void> {
  const env = 'APIARY_CONFIG_ROOT=/home/dev/fixture APIARY_DB_PATH=/home/dev/fixture/apiary.db APIARY_DEFAULT_THEME=original APIARY_GLAB_PATH= APIARY_CODE_PATH='
  await must(`cd /app && ${env} nohup ./node_modules/.bin/electron . --no-sandbox --disable-gpu --user-data-dir=/home/dev/fixture/userdata > /home/dev/app.out 2>&1 &`)
}

/** Stops the app outright: what comes back must be what was saved as the windows changed, not
 *  something written at quit (the test has already seen the layout file). */
async function stop(): Promise<void> {
  await sh('pkill -KILL -x electron')
  await until(async () => (await sh('pgrep -x electron')).code, (code) => code !== 0, 'the app to stop')
}

describe.skipIf(!enabled)('windows come back on their own monitors (Ubuntu 26.04, GNOME on Wayland, two monitors)', () => {
  beforeAll(async () => {
    const built = await run('docker', ['build', '--progress=plain', '-t', IMAGE, '-f', 'tests/windows/docker/Dockerfile', REPO], 1_800_000)
    if (built.code !== 0) throw new Error(`docker build failed: ${built.stderr.slice(-3000)}`)
    await run('docker', ['image', 'prune', '-f', '--filter', `label=${LABEL}`])
    container = `apiary-windows-${String(process.pid)}-${String(Date.now())}`
    // `--init` reaps the app's processes once stopped; `sleep` as pid 1 would leave them as zombies.
    const started = await run('docker', ['run', '-d', '--init', '--name', container, IMAGE])
    if (started.code !== 0) throw new Error(`docker run failed: ${started.stderr}`)
    const monitors = await must('desktop')
    expect(monitors).toMatch(/Monitors: 2/)
    dir = mkdtempSync('/tmp/apiary-windows-')
    const home = writeFixtureHome(dir, { diagnosticsEnabled: true })
    await must('rm -rf /home/dev/fixture', 'root')
    expect((await run('docker', ['cp', home, `${container}:/home/dev/fixture`])).code).toBe(0)
    await must('chown -R dev:dev /home/dev/fixture', 'root')
  })

  afterAll(async () => {
    if (container !== '' && process.env.APIARY_WINDOWS_KEEP !== '1') await run('docker', ['rm', '-f', container])
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  it('a window at its own size on the left monitor and a maximised one on the right come back so', async () => {
    await launch()
    const [first] = await until(appWindows, (w) => w.length === 1, 'the first window')
    if (first === undefined) throw new Error('no first window')
    // Run again through XWayland, which is what lets it place its windows.
    expect((await sh("ps -eo args= | grep -v -- '--type=' | grep 'electron'")).stdout).toContain('--ozone-platform=x11')
    await must(`xdotool windowactivate --sync ${first.id} key --clearmodifiers ctrl+n`)
    const both = await until(appWindows, (w) => w.length === 2, 'a second window')
    const second = both.find((w) => w.id !== first.id)!
    // The window manager moves them, as dragging a window to another monitor does.
    await must(`wmctrl -i -r ${first.id} -e 0,200,150,1100,750`)
    await must(`wmctrl -i -r ${second.id} -e 0,2200,120,1200,800 && wmctrl -i -r ${second.id} -b add,maximized_vert,maximized_horz`)
    await until(appWindows, (w) => w.some((x) => x.maximized && x.x >= 1920), 'the second window maximised on the right')
    // Saved as they change: the layout file has both, one maximised.
    await until(
      async () => (await sh('cat /home/dev/fixture/userdata/session-layout.json')).stdout,
      (text) => /"maximized": ?true/.test(text) && (text.match(/"number"/g) ?? []).length === 2,
      'the layout file to keep both windows',
    )
    await stop()
    // A window with no tab is not brought back: give each the fixture's session, as opening it would.
    await must(`node -e '${WITH_A_TAB}' /home/dev/fixture/userdata/session-layout.json`)

    await launch()
    const back = await until(appWindows, (w) => w.length === 2 && w.some((x) => x.maximized), 'both windows back, one maximised', 45_000)
    const left = back.find((w) => !w.maximized)!
    const right = back.find((w) => w.maximized)!
    // Left: where it was, its size (within what the window manager's frame adds or takes).
    expect(Math.abs(left.x - 200)).toBeLessThanOrEqual(40)
    expect(Math.abs(left.y - 150)).toBeLessThanOrEqual(40)
    expect(Math.abs(left.width - 1100)).toBeLessThanOrEqual(40)
    expect(Math.abs(left.height - 750)).toBeLessThanOrEqual(40)
    expect(left.x + left.width).toBeLessThanOrEqual(1920)
    // Right: maximised on the right monitor, filling its width.
    expect(right.x).toBeGreaterThanOrEqual(1920)
    expect(right.width).toBeGreaterThanOrEqual(1800)

    // Un-maximised, it goes back to the size it had on that monitor.
    await must(`wmctrl -i -r ${right.id} -b remove,maximized_vert,maximized_horz`)
    const restored = await until(appWindows, (w) => w.some((x) => x.id === right.id && !x.maximized), 'the right window un-maximised')
    const normal = restored.find((w) => w.id === right.id)!
    expect(normal.x).toBeGreaterThanOrEqual(1920)
    expect(Math.abs(normal.width - 1200)).toBeLessThanOrEqual(40)
    await stop()
  })
})
