import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResidentConfig } from '@shared/domain/residents'
import { builtinKinds, newResident, type ResidentKind } from '../../../src/main/residents/kinds'
import { residentFlags } from '../../../src/main/residents/residentChat'
import { nodeKindFiles } from '../../../src/main/residents/kinds/kindHost'
import { resolveResourcesDir } from '../../../src/main/app/resourcesDir'
import { MR_DESK_BLOCKED, mraSubcommandsIn, subcommandsFromHelp } from '../../../src/main/residents/kinds/mrDeskMra'
import { CLAUDE_SETTINGS_FILE, pathFirstSettings } from '../../../src/main/residents/claudeSettings'
import { apiaryStatusText } from '../../../src/main/residents/statusText'

const RESOURCES = resolveResourcesDir({ packaged: false, resourcesPath: '', appPath: process.cwd() })
const MRA_DIR = join(RESOURCES, 'residents', 'mra')

/** The subcommands of the vendored mra's top-level parser, read from its source. */
function vendoredSubcommands(): Set<string> {
  const src = readFileSync(join(MRA_DIR, 'mra', 'cli.py'), 'utf8')
  return new Set([...src.matchAll(/\bsub\.add_parser\('([a-z][a-z-]*)'/g)].map((m) => m[1] ?? ''))
}

const HELP = (subs: string[]): string => `usage: mra [-h] {${subs.join(',')}} ...\n\npositional arguments:\n  {${subs.join(',')}}\n`

function desk(help: string): ResidentKind {
  const kind = builtinKinds({
    resourceDir: (id) => join(RESOURCES, 'residents', id),
    searchPath: () => '/usr/bin',
    files: nodeKindFiles,
    exec: async (_file, args) => (args.includes('--help') ? help : ''),
  }).find((k) => k.id === 'mr-desk')
  if (kind === undefined) throw new Error('no mr-desk kind')
  return kind
}
const configured = (kind: ResidentKind): ResidentConfig => ({ ...newResident(kind, new Set()), options: { project: 'grp/app', repoPath: '/code/app' } })

let space: string
beforeEach(() => { space = mkdtempSync(join(tmpdir(), 'apiary-mrdesk-a-')) })
afterEach(() => { rmSync(space, { recursive: true, force: true }) })

describe('the prompt and the vendored mra agree', () => {
  it('every `mra <sub>` the prompt names is a subcommand of the vendored mra', () => {
    const prompt = desk('').systemPrompt('Desk')
    const named = mraSubcommandsIn(prompt)
    expect(named).toContain('rules')
    expect(named).toContain('verdict')
    expect(named).toContain('which')
    const have = vendoredSubcommands()
    expect(named.filter((s) => !have.has(s))).toEqual([])
  })

  it('reads the subcommands from argparse help', () => {
    expect(subcommandsFromHelp(HELP(['poll', 'todo-done', 'rules']))).toEqual(['poll', 'todo-done', 'rules'])
    expect(subcommandsFromHelp('nonsense')).toEqual([])
  })

  it('setup says which named subcommands the installed mra lacks, after prepare ran its help', async () => {
    const all = mraSubcommandsIn(desk('').systemPrompt('Desk'))
    const lacking = desk(HELP(all.filter((s) => s !== 'rules' && s !== 'verdict')))
    await lacking.prepare?.(configured(lacking), space)
    expect(lacking.setup(configured(lacking))).toBe('mra is missing: rules, verdict')
    const fine = desk(HELP(all))
    await fine.prepare?.(configured(fine), space)
    expect(fine.setup(configured(fine))).toBeNull()
  })
})

describe('blocked commands explain themselves', () => {
  it('every disallowed tool comes from the table and has its replacement in the prompt', () => {
    const kind = desk('')
    expect(kind.toolPolicy?.disallowedTools).toEqual(MR_DESK_BLOCKED.map((b) => b.tool))
    const prompt = kind.systemPrompt('Desk')
    for (const b of MR_DESK_BLOCKED) {
      expect(b.instead.length).toBeGreaterThan(0)
      expect(prompt).toContain(`\`${b.command}\` → ${b.instead}`)
    }
    expect(prompt).toContain('`glab api` → `mra api <path>` (GET only)')
    expect(prompt).toContain('request_user_action')
  })
})

describe('PATH first through a settings file', () => {
  it('the MR desk writes a SessionStart hook that puts its bin first, owner-only, and claude gets --settings', async () => {
    const kind = desk(HELP(mraSubcommandsIn(desk('').systemPrompt('D'))))
    expect(kind.pathFirst?.(space)).toBe(`${space}/bin`)
    await kind.prepare?.(configured(kind), space)
    const file = join(space, CLAUDE_SETTINGS_FILE)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(pathFirstSettings(`${space}/bin`))
    const flags = residentFlags({ mcpConfig: 'm', model: 'opus', systemPrompt: 'p', permissionMode: 'auto', settingsFile: file }, null)
    expect(flags.slice(flags.indexOf('--settings'), flags.indexOf('--settings') + 2)).toEqual(['--settings', file])
    expect(residentFlags({ mcpConfig: 'm', model: 'opus', systemPrompt: 'p', permissionMode: 'auto' }, null)).not.toContain('--settings')
  })
})

describe('apiary_status says what the claude was started with', () => {
  it('lists the mode, allowed and disallowed tools and when they were loaded', () => {
    const kind = desk('')
    const config = configured(kind)
    const self = {
      id: config.id, kind: kind.id, name: 'Desk', enabled: true, state: 'idle' as const, activity: null, onDuty: true, appearance: kind.appearance,
      digest: null, attention: null, permissions: [], quickActions: [], setupNeeded: null, cycle: null,
    }
    const report = { self, config, lookback: null, index: null, others: [], now: new Date(0), background: [] }
    expect(apiaryStatusText({ ...report, permissions: null })).toContain('Permissions: your claude has not been started yet.')
    const text = apiaryStatusText({ ...report, permissions: { mode: 'auto', allowedTools: ['mcp__apiary__*'], disallowedTools: ['Bash(git push:*)'], settingsLoadedAt: '2026-11-11T00:00:00.000Z' } })
    expect(text).toContain('Permissions (as your claude was started at 2026-11-11T00:00:00.000Z): mode auto; allowed: mcp__apiary__*; disallowed: Bash(git push:*).')
  })
})
