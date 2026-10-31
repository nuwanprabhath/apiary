import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ResidentConfig } from '@shared/domain/residents'
import { mraDirIn, resolveResourcesDir } from '../../../src/main/app/resourcesDir'
import { createExec } from '../../../src/main/exec/run'
import { builtinKinds, kindLookup, newResident } from '../../../src/main/residents/kinds'
import { nodeKindFiles, searchPathFrom } from '../../../src/main/residents/kinds/kindHost'
import { ResidentService, type ResidentSettings } from '../../../src/main/residents/residentService'

const repoRoot = resolve(__dirname, '../../..')
const mraDir = mraDirIn(resolveResourcesDir({ packaged: false, resourcesPath: '', appPath: repoRoot }))
const exec = createExec({ timeoutMs: 120_000, env: { PYTHONDONTWRITEBYTECODE: '1' } })

const hasPython = await exec('python3', ['--version'], repoRoot).then(() => true, () => false)

const MR = JSON.stringify({
  iid: 5, title: 'fix: the thing', description: '', web_url: 'https://gl.test/g/p/-/merge_requests/5',
  author: { username: 'alice' }, assignees: [], reviewers: [{ username: 'me' }],
  source_branch: 'f', target_branch: 'dev/1.0.12', labels: [], draft: false, sha: 'a'.repeat(40),
  updated_at: '2026-10-28T00:00:00Z', created_at: '2026-10-01T00:00:00Z', has_conflicts: false,
  detailed_merge_status: 'mergeable', head_pipeline: { id: 9, status: 'success', web_url: 'u' },
})

/** A `glab` that answers only the calls `mra desk` makes, for a project `g/p` with one open MR to review. */
const FAKE_GLAB = `#!/bin/sh
[ "$1" = auth ] && exit 0
for last; do :; done
case "$last" in
  user) echo '{"username":"me"}' ;;
  projects/g%2Fp) echo '{"id":7}' ;;
  *merge_requests?state=opened*) echo '[${MR}]' ;;
  *todos*) echo '[]' ;;
  */approvals) echo '{"approved_by":[]}' ;;
  */reviewers) echo '[]' ;;
  */discussions*) echo '[]' ;;
  *merge_requests/5) echo '${MR}' ;;
  *) echo "fake glab: unexpected $last" >&2; exit 1 ;;
esac
`

let dir: string
let services: ResidentService[] = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-mrdesk-')) })
afterEach(async () => {
  for (const s of services) await s.dispose()
  services = []
  rmSync(dir, { recursive: true, force: true })
})

describe('the bundled mra', () => {
  it('is found in development under <repo>/resources/residents/mra', () => {
    expect(mraDir).toBe(join(repoRoot, 'resources', 'residents', 'mra'))
    for (const file of ['bin/mra', 'RESIDENT.md', 'LICENSE', 'README.md', 'config.example.json', 'prompts/review.tmpl']) {
      expect([file, existsSync(join(mraDir, file))]).toEqual([file, true])
    }
  })

})

// The suites below run python3; without it they are listed as skipped, and their names say why.
describe.runIf(hasPython)('the bundled mra, run (needs python3)', () => {
  it('passes its own Python tests', async () => {
    await expect(exec('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], mraDir)).resolves.toBeDefined()
  })

  it('the wrapper the kind writes runs `mra --help` as a bare command', async () => {
    const kind = builtinKinds({ mraDir: () => mraDir, exec, searchPath: () => process.env.PATH ?? '', files: nodeKindFiles }).find((k) => k.id === 'mr-desk')
    const config = newResident(kind ?? (() => { throw new Error('no kind') })(), new Set())
    await kind?.prepare?.({ ...config, options: { project: 'g/p', repoPath: dir } }, dir)
    const out = await exec(join(dir, 'bin', 'mra'), ['--help'], '/')
    expect(out).toContain('MR manager')
  })
})

describe.runIf(hasPython)('"Show the desk" against a fake glab (needs python3)', () => {
  it('appends the desk markdown to the resident\'s history', async () => {
    const bin = join(dir, 'fake-bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'glab'), FAKE_GLAB)
    chmodSync(join(bin, 'glab'), 0o755)
    const path = `${bin}:${searchPathFrom(process.env.PATH)}`
    const config: ResidentConfig = {
      ...newResident(builtinKinds({ mraDir: () => mraDir, exec, searchPath: () => path, files: nodeKindFiles }).find((k) => k.id === 'mr-desk')!, new Set()),
      options: { project: 'g/p', repoPath: dir },
    }
    let list = [config]
    const settings: ResidentSettings = { get: () => list, set: (l) => { list = l }, onChange: () => () => {} }
    const service = new ResidentService({
      settings, root: join(dir, 'residents'), knowledge: null, digest: null, usagePercent: () => null,
      claudeBin: () => 'claude', launchEnv: () => ({}),
      tools: { session: () => null, openSession: () => {}, openTabs: () => [], focusedWindow: () => null },
      onChanged: () => {}, onMessage: () => {}, version: '0.0.0',
      kindOf: kindLookup({ mraDir: () => mraDir, exec: createExec({ env: { PATH: path } }), searchPath: () => path, files: nodeKindFiles }),
    })
    services.push(service)
    service.start()
    await service.quickAction('mr-desk', 'desk')
    const last = service.history('mr-desk').at(-1)
    expect(last?.role).toBe('assistant')
    expect(last?.text).toContain('**Waiting on you** (1)')
    expect(last?.text).toContain('1. [!5](https://gl.test/g/p/-/merge_requests/5) fix: the thing · @alice · → dev/1.0.12 · review')
    expect(service.list()[0].setupNeeded).toBeNull()
  })
})
