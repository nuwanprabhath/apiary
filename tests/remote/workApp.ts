import { expect } from 'vitest'
import { writeFixtureHome, type Bed } from './harness'

/** A Unix-socket echo server, run in the container as `dev`: proves a forward carries bytes both ways. */
export const ECHO_SERVER = `
const net = require('node:net'), fs = require('node:fs')
const path = process.argv[2]
try { fs.unlinkSync(path) } catch {}
net.createServer((c) => c.on('data', (d) => c.write(d))).listen(path, () => fs.chmodSync(path, 0o600))
`

/** The built app under xvfb as `dev`, against the fixture home. Mirrors e2e's `launchApiary`. */
export async function launchApp(bed: Bed, settings: Record<string, unknown>): Promise<void> {
  // The log is the proof the window loaded, and diagnostics are off by default.
  const home = writeFixtureHome(bed.dir, { diagnosticsEnabled: true, ...settings })
  // `docker cp` into an existing directory nests the copy inside it, so a relaunch would read the
  // previous run's settings: start from an empty place.
  await bed.exec(['rm', '-rf', '/home/dev/fixture'])
  await bed.copyIn(home, '/home/dev/fixture')
  await bed.exec(['chown', '-R', 'dev:dev', '/home/dev/fixture'])
  const env = [
    'APIARY_CONFIG_ROOT=/home/dev/fixture',
    'APIARY_DB_PATH=/home/dev/fixture/apiary.db',
    'APIARY_DEFAULT_THEME=original',
    'APIARY_HEADLESS=1',
    'APIARY_GLAB_PATH=',
    'APIARY_CODE_PATH=',
  ].join(' ')
  const cmd = `cd /app && ${env} nohup xvfb-run -a ./node_modules/.bin/electron . --no-sandbox --disable-gpu `
    + '--user-data-dir=/home/dev/fixture/userdata > /home/dev/app.out 2>&1 & echo $! > /home/dev/app.pid'
  const r = await bed.exec(['bash', '-c', cmd], 'dev')
  expect(r.code).toBe(0)
}
