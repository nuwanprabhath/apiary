import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResidentConfig } from '@shared/domain/residents'
import { builtinKinds, newResident, type ResidentKind } from '../../../src/main/residents/kinds'
import { expandArgv } from '../../../src/main/residents/quickActions'
import { mraConfigFor } from '../../../src/main/residents/kinds/mrDeskConfig'
import { nodeKindFiles, searchPathFrom } from '../../../src/main/residents/kinds/kindHost'
import { mraDirIn, resolveResourcesDir } from '../../../src/main/app/resourcesDir'

const MRA = '/res/residents/mra'

/** Which commands "exist": the exec stub answers `python3 --version` and `glab auth status` from it. */
function desk(tools: { python3?: boolean; glab?: boolean } = {}): ResidentKind {
  const found = { python3: true, glab: true, ...tools }
  const kinds = builtinKinds({
    mraDir: () => MRA,
    searchPath: () => '/usr/bin:/bin',
    files: nodeKindFiles,
    exec: async (file) => {
      if (file === 'python3' ? found.python3 : found.glab) return ''
      throw new Error(`${file}: not found`)
    },
  })
  const kind = kinds.find((k) => k.id === 'mr-desk')
  if (kind === undefined) throw new Error('no mr-desk kind')
  return kind
}

const configured = (kind: ResidentKind, options: Record<string, string> = { project: 'grp/app', repoPath: '/code/app' }): ResidentConfig =>
  ({ ...newResident(kind, new Set()), options })

let space: string
beforeEach(() => { space = mkdtempSync(join(tmpdir(), 'apiary-mrdesk-')) })
afterEach(() => { rmSync(space, { recursive: true, force: true }) })

describe('the MR desk kind', () => {
  it('is Opus on auto, Monday to Friday, with no digest, and offers its three options', () => {
    const kind = desk()
    expect(kind.defaults).toMatchObject({
      name: 'MR Desk', model: 'opus', permissionMode: 'auto', schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    })
    expect(kind.digests).toBe(false)
    expect(kind.appearance).toEqual({ glyph: 'honeypot', palette: 'amber', animation: 'stir' })
    expect(kind.capabilities).toEqual(['space.notes', 'apiary.status', 'resident.attention', 'sessions.read', 'workspace.open'])
    expect(kind.optionFields.map((f) => [f.key, f.input, f.required])).toEqual([
      ['project', 'text', true], ['repoPath', 'folder', true], ['username', 'text', false],
    ])
    expect(kind.cycle).toEqual({ everyMinutes: 15, prompt: 'Run one MR desk cycle.', doing: 'Checking your MRs' })
  })

  it('setup reports the first thing missing, in order', async () => {
    const kind = desk({ python3: false, glab: false })
    expect(kind.setup(configured(kind, {}))).toBe('Set the GitLab project in Settings')
    expect(kind.setup(configured(kind, { project: 'grp/app' }))).toBe('Choose your local clone in Settings')
    const set = configured(kind)
    expect(kind.setup(set)).toBeNull()
    await kind.prepare?.(set, space)
    expect(kind.setup(set)).toBe('Install Python 3')

    const noGlab = desk({ glab: false })
    await noGlab.prepare?.(set, space)
    expect(noGlab.setup(set)).toBe('Run `glab auth login` in a terminal')

    const fine = desk()
    await fine.prepare?.(set, space)
    expect(fine.setup(set)).toBeNull()
  })

  it('prepare writes config.json from the options: active_hours null, username only when set', async () => {
    const kind = desk()
    await kind.prepare?.(configured(kind), space)
    const file = join(space, 'mra', 'config.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ project: 'grp/app', repo_path: '/code/app', active_hours: null })
    await kind.prepare?.(configured(kind, { project: ' grp/app ', repoPath: '/code/app', username: ' me ' }), space)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ project: 'grp/app', repo_path: '/code/app', username: 'me', active_hours: null })
    expect(mraConfigFor({ project: 'a/b', repoPath: '/r', username: '   ' })).not.toHaveProperty('username')
  })

  it('prepare writes the mra wrapper, owner-only, and env points mra at the space', async () => {
    const kind = desk()
    await kind.prepare?.(configured(kind), space)
    const wrapper = join(space, 'bin', 'mra')
    expect(readFileSync(wrapper, 'utf8')).toBe(`#!/bin/sh\nexec python3 '${MRA}/bin/mra' "$@"\n`)
    expect(statSync(wrapper).mode & 0o777).toBe(0o700)
    expect(kind.env?.(configured(kind), space)).toEqual({
      MRA_CONFIG: join(space, 'mra', 'config.json'),
      MRA_STATE_DIR: join(space, 'mra', 'state'),
      PATH: `${join(space, 'bin')}:/usr/bin:/bin`,
    })
  })

  it('a project given as a URL is written as its path and host; the setting is left as typed', async () => {
    const kind = desk()
    const config = configured(kind, { project: 'https://gitlab.com/ternandsparrow/paratoo-fdcp', repoPath: '/code/app' })
    expect(kind.setup(config)).toBeNull()
    await kind.prepare?.(config, space)
    expect(JSON.parse(readFileSync(join(space, 'mra', 'config.json'), 'utf8'))).toEqual({
      project: 'ternandsparrow/paratoo-fdcp', gitlab_host: 'gitlab.com', repo_path: '/code/app', active_hours: null,
    })
    expect(config.options.project).toBe('https://gitlab.com/ternandsparrow/paratoo-fdcp')
  })

  it('setup says what a project should look like when it cannot be read', () => {
    const kind = desk()
    for (const project of ['just-a-name', 'ftp://host/a/b', 'https://gitlab.com/', 'not a path/x y']) {
      expect(kind.setup(configured(kind, { project, repoPath: '/code/app' }))).toBe('The GitLab project should look like group/project')
    }
    expect(kind.optionFields.find((f) => f.key === 'project')?.help).toMatch(/group\/project.*URL/)
  })

  it('does not write a config mra would refuse until a project and a clone are set', async () => {
    const kind = desk()
    await kind.prepare?.(configured(kind, { project: 'grp/app' }), space)
    expect(() => readFileSync(join(space, 'mra', 'config.json'), 'utf8')).toThrow(/ENOENT/)
  })

  it('quick actions expand to the python3 program, and the two prompts are sent as typed', () => {
    const kind = desk()
    const ctx = { options: configured(kind).options, bins: kind.bins }
    const argv = (id: string): string[] => {
      const run = kind.quickActions.find((a) => a.id === id)?.run
      if (run?.kind !== 'command') throw new Error(`${id} is not a command`)
      return expandArgv(run.argv, ctx)
    }
    expect(argv('desk')).toEqual(['python3', `${MRA}/bin/mra`, 'desk'])
    expect(argv('stats-week')).toEqual(['python3', `${MRA}/bin/mra`, 'stats', 'week'])
    expect(argv('stats-month')).toEqual(['python3', `${MRA}/bin/mra`, 'stats', 'month'])
    expect(kind.quickActions.map((a) => a.label)).toEqual([
      'Show the desk', 'Stats: last week', 'Stats: last month', 'Check my MRs now', 'Mark the backlog as seen',
    ])
    expect(kind.quickActions.filter((a) => a.run.kind === 'prompt').map((a) => a.run)).toEqual([
      { kind: 'prompt', text: 'Run one MR desk cycle.' },
      { kind: 'prompt', text: 'Run `mra baseline` and tell me what it marked.' },
    ])
  })

  it('the system prompt is the vendored RESIDENT.md behind a short Apiary preamble, with every hard rule', () => {
    const kind = builtinKinds({ mraDir: () => mraDirIn(resolveResourcesDir({ packaged: false, resourcesPath: '', appPath: process.cwd() })), exec: async () => '', searchPath: () => '', files: nodeKindFiles })
      .find((k) => k.id === 'mr-desk')
    const prompt = kind?.systemPrompt('Desk', 30) ?? ''
    expect(prompt).toContain('You are Desk, the user\'s MR desk')
    expect(prompt).toContain('every 30 minutes during your hours it sends "Run one MR desk cycle." in this chat itself')
    expect(prompt).toContain('call `apiary_status`')
    expect(prompt).toContain('Never say nothing runs in the background')
    expect(prompt).not.toContain('nothing else starts one')
    expect(prompt).toContain('set_attention')
    expect(prompt).toContain('clear_attention')
    expect(prompt).toContain('set_activity')
    expect(prompt).toContain('Never post a note, reply, review or comment to GitLab')
    expect(prompt).toContain('Approve only when the user names')
    expect(prompt).toContain('Resolve only threads the user started')
    expect(prompt).toContain('Never start a CI pipeline')
    expect(prompt).toContain('No Claude attribution trailers')
    expect(prompt).not.toMatch(/CronCreate|start the MR loop|stop the MR loop/)
  })
})

describe('where the bundled programs are', () => {
  it('is the repo\'s resources folder in development and the resources path when packaged', () => {
    expect(resolveResourcesDir({ packaged: false, resourcesPath: '/App/Resources', appPath: '/repo' })).toBe('/repo/resources')
    expect(resolveResourcesDir({ packaged: true, resourcesPath: '/App/Resources', appPath: '/App/app.asar' })).toBe('/App/Resources')
    expect(mraDirIn('/App/Resources')).toBe('/App/Resources/residents/mra')
  })

  it('adds the Homebrew directories after PATH once', () => {
    expect(searchPathFrom('/usr/bin:/opt/homebrew/bin')).toBe('/usr/bin:/opt/homebrew/bin:/usr/local/bin')
    expect(searchPathFrom(undefined)).toBe('/opt/homebrew/bin:/usr/local/bin')
  })
})
