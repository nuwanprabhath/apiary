import { MR_DESK_KIND } from '@shared/domain/residents'
import type { ResidentConfig } from '@shared/domain/residents'
import { RESIDENT_FIELD_DEFAULTS } from '@shared/settings/residents'
import type { ResidentKind } from '../kindTypes'
import { errorMessage } from '@shared/errors'
import { log } from '../../log/logger'
import { CLAUDE_SETTINGS_FILE, pathFirstSettings } from '../claudeSettings'
import type { KindDeps } from './kindDeps'
import { mraConfigFor, mraConfigured, mraWrapper, optionOf } from './mrDeskConfig'
import { ToolProbe } from './mrDeskTools'
import { parseGitlabProject } from './mrDeskProject'
import { MR_DESK_DISALLOWED, blockedLines, mraSubcommandsIn, subcommandsFromHelp } from './mrDeskMra'
import { MR_DESK_USER_ACTIONS, mrHeadOf } from './mrDeskActions'

const CYCLE_PROMPT = 'Run one MR desk cycle.'
const CYCLE_DOING = 'Checking your MRs'
const CYCLE_DEFAULT_MINUTES = 15

/** Apiary's part of the prompt: who it is here and the tools Apiary gives it. The rest is `RESIDENT.md`. */
const preamble = (name: string, everyMinutes: number): string => [
  `You are ${name}, the user's MR desk, living inside Apiary.`,
  `Apiary runs your cycle in the background: every ${String(everyMinutes)} minutes during your hours it sends "${CYCLE_PROMPT}" in this chat itself, so you never need to start one.`,
  'When the user asks when the next check is, or whether anything runs in the background, call `apiary_status`: it says how often the cycle runs, when the next one is and whether one is running. Never say nothing runs in the background.',
  '`mra` is a command on your PATH (a wrapper Apiary wrote); every `mra …` below runs in your shell as written.',
  'Approve only with the Apiary tool `approve_mr` (it asks the user, then approves); `glab` writes and `git push` are blocked for you.',
  'Draft comments are yours to write: `mra draft add|list|edit|move|delete` (only the user sees a draft). Publishing drafts, replying in a thread and resolving a thread go only through the Apiary tool `request_user_action` (`publish_drafts`, `reply` with the exact body, `resolve`): Apiary shows the user what will happen and runs it only if they allow it. Read GitLab with `mra api <path>`.',
  ...blockedLines(),
  'When asked what you may run, `apiary_status` lists the permissions your claude was started with.',
  'Apiary tools: `set_activity` (a few words while you work), `set_attention` / `clear_attention` (the badge on your icon), `note_put` / `note_list` (your notes).',
  '',
].join('\n')

/** The MR desk: the vendored `mra` CLI (`resources/residents/mra`) run on a 15-minute cycle by a chat with full tools. */
export function createMrDesk(deps: KindDeps): ResidentKind {
  const probe = new ToolProbe(deps.exec)
  const mraDir = (): string => deps.resourceDir('mra')
  const script = (): string => `${mraDir()}/bin/mra`
  /** Invalidated by `prepare`, which reads `mra --help` again. Null until then: nothing is reported missing. */
  let missingSubs: string[] | null = null
  const systemPrompt = (name: string, cycleMinutes = CYCLE_DEFAULT_MINUTES): string =>
    preamble(name, cycleMinutes) + deps.files.readText(`${mraDir()}/RESIDENT.md`)
  const checkSubcommands = async (space: string): Promise<void> => {
    let help: string
    try {
      help = await deps.exec('python3', [script(), '--help'], space)
    } catch (e) {
      log.warn('residents', 'mra --help failed', { error: errorMessage(e) })
      missingSubs = null
      return
    }
    const have = new Set(subcommandsFromHelp(help))
    if (have.size === 0) { missingSubs = null; return }
    missingSubs =mraSubcommandsIn(systemPrompt('')).filter((s) => !have.has(s))
    if (missingSubs.length > 0) log.warn('residents', 'mra lacks subcommands the prompt names', { missing: missingSubs.join(',') })
  }
  return {
    id: MR_DESK_KIND,
    defaults: {
      name: 'MR Desk',
      enabled: false,
      model: 'opus',
      digestModel: 'haiku',
      schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      pauseAboveUsagePercent: 70,
      ...RESIDENT_FIELD_DEFAULTS,
      permissionMode: 'auto',
    },
    blurb: 'Watches the GitLab MRs you review, reviews new ones and tells you which are ready to approve.',
    appearance: { glyph: 'honeypot', palette: 'amber', animation: 'stir' },
    capabilities: ['space.notes', 'apiary.status', 'resident.attention', 'sessions.read', 'workspace.open', 'gitlab.approve'],
    toolPolicy: { disallowedTools: MR_DESK_DISALLOWED },
    approval: {
      readArgv: (iid) => ['{bin:mra}', 'ready', `!${String(iid)}`],
      parseHead: mrHeadOf,
      approveArgv: (iid) => ['{bin:mra}', 'approve', `!${String(iid)}`],
      nonceFile: (space) => `${space}/mra/state/approve.nonce`,
      nonceEnv: 'MRA_APPROVE_NONCE',
    },
    userActions: MR_DESK_USER_ACTIONS,
    pathFirst: (space) => `${space}/bin`,
    digests: false,
    optionFields: [
      { key: 'project', label: 'GitLab project', help: 'GitLab project path (group/project) or its URL', input: 'text', required: true },
      { key: 'repoPath', label: 'Local clone', help: 'Your local clone, used for review worktrees', input: 'folder', required: true },
      { key: 'username', label: 'GitLab username', help: 'Your GitLab username (defaults to glab\'s login)', input: 'text', required: false },
    ],
    quickActions: [
      { id: 'desk', label: 'Show the desk', doing: 'Reading the desk', run: { kind: 'command', argv: ['{bin:mra}', 'desk'] } },
      { id: 'stats-week', label: 'Stats: last week', doing: "Counting last week's MRs", run: { kind: 'command', argv: ['{bin:mra}', 'stats', 'week'] } },
      { id: 'stats-month', label: 'Stats: last month', doing: "Counting last month's MRs", run: { kind: 'command', argv: ['{bin:mra}', 'stats', 'month'] } },
      { id: 'check-now', label: 'Check my MRs now', doing: CYCLE_DOING, run: { kind: 'prompt', text: CYCLE_PROMPT } },
      {
        id: 'baseline', label: 'Mark the backlog as seen', doing: 'Marking the backlog as seen',
        run: { kind: 'prompt', text: 'Run `mra baseline` and tell me what it marked.' },
      },
    ],
    bins: { mra: () => ['python3', script()] },
    cycle: { everyMinutes: CYCLE_DEFAULT_MINUTES, prompt: CYCLE_PROMPT, doing: CYCLE_DOING },
    instantMatches: false,
    setup: (config: ResidentConfig) => {
      if (optionOf(config.options, 'project') === '') return 'Set the GitLab project in Settings'
      if (parseGitlabProject(optionOf(config.options, 'project')) === null) return 'The GitLab project should look like group/project'
      if (optionOf(config.options, 'repoPath') === '') return 'Choose your local clone in Settings'
      const missing = probe.missing()
      if (missing === 'python3') return 'Install Python 3'
      if (missing === 'glab') return 'Run `glab auth login` in a terminal'
      return missingSubs !== null && missingSubs.length > 0 ? `mra is missing: ${missingSubs.join(', ')}` : null
    },
    env: (_config, space) => ({
      MRA_CONFIG: `${space}/mra/config.json`,
      MRA_STATE_DIR: `${space}/mra/state`,
      PATH: `${space}/bin:${deps.searchPath()}`,
    }),
    prepare: async (config, space) => {
      deps.files.ensureDir(`${space}/bin`)
      deps.files.writeExecutable(`${space}/bin/mra`, mraWrapper(script()))
      deps.files.writePrivateJson(`${space}/${CLAUDE_SETTINGS_FILE}`, pathFirstSettings(`${space}/bin`))
      if (mraConfigured(config.options)) {
        deps.files.ensureDir(`${space}/mra`)
        deps.files.writeJson(`${space}/mra/config.json`, mraConfigFor(config.options))
      }
      await Promise.all([probe.refresh(space), checkSubcommands(space)])
    },
    systemPrompt,
  }
}
