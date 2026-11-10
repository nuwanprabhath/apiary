import {
  REGENT_KIND, SESSION_LINK_PREFIX, type ResidentConfig, type ResidentKindId, type ResidentKindInfo,
} from '@shared/domain/residents'
import { RESIDENT_FIELD_DEFAULTS } from '@shared/settings/residents'
import { type KindDeps, UNWIRED_KIND_DEPS } from './kinds/kindDeps'
import { createMrDesk } from './kinds/mrDesk'
import type { ResidentKind } from './kindTypes'

export type { ResidentCapability, ResidentKind } from './kindTypes'
export type { KindDeps } from './kinds/kindDeps'

const regent: ResidentKind = {
  id: REGENT_KIND,
  defaults: {
    name: 'Regent',
    enabled: false,
    model: 'sonnet',
    digestModel: 'haiku',
    schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
    pauseAboveUsagePercent: 70,
    ...RESIDENT_FIELD_DEFAULTS,
  },
  blurb: 'A chief of staff over every Claude session: finds, opens and answers from them.',
  appearance: { glyph: 'bee', palette: 'gold', animation: 'halo' },
  capabilities: ['sessions.read', 'workspace.read', 'workspace.open', 'space.notes', 'apiary.status', 'resident.attention'],
  digests: true,
  optionFields: [],
  quickActions: [],
  bins: {},
  instantMatches: true,
  setup: () => null,
  systemPrompt: (name) => [
    `You are ${name}, the user's chief of staff over their Claude Code sessions, living inside Apiary.`,
    'Your first job is their sessions, through the Apiary tools:',
    '- To find a session, call find_sessions first, then session_topics or read_session to confirm what it is about.',
    '- When asked to open or bring up a session and exactly one clearly matches, call open_session and say in one line which session you opened.',
    `- When several could match, list them as markdown links [title](${SESSION_LINK_PREFIX}<id>), each with a one-line reason, and ask which one.`,
    `- When asked a question, answer from what you read, and cite every session you used as a ${SESSION_LINK_PREFIX}<id> link.`,
    '- When asked how far the digest has got, or about yourself or the other residents, call apiary_status.',
    '- When the user teaches you a name for something (an alias, a nickname for a session or project), remember it with note_put. When a name is unfamiliar, check note_list before searching.',
    'You also have the user\'s normal Claude Code tools: the shell (glab, gh, git), the web, and their own MCP servers. Use them when asked (an MR\'s status, a ticket, a web search); the user approves what needs approving.',
    '- Be brief.',
  ].join('\n'),
}

/** Every built-in kind, with the outside world (where the bundled programs are, which tools exist) in `deps`. */
export function builtinKinds(deps: KindDeps): readonly ResidentKind[] {
  return [regent, createMrDesk(deps)]
}

/** The kinds this build can run, in registration order. */
export class KindRegistry {
  private readonly kinds = new Map<ResidentKindId, ResidentKind>()

  register(kind: ResidentKind): void {
    if (this.kinds.has(kind.id)) throw new Error(`Resident kind already registered: ${kind.id}`)
    this.kinds.set(kind.id, kind)
  }

  get(id: ResidentKindId): ResidentKind {
    const kind = this.kinds.get(id)
    if (kind === undefined) throw new Error(`Unknown resident kind: ${id}`)
    return kind
  }

  all(): readonly ResidentKind[] { return [...this.kinds.values()] }
}

/** A registry holding every built-in kind built with `deps`. */
function builtinRegistry(deps: KindDeps): KindRegistry {
  const registry = new KindRegistry()
  for (const kind of builtinKinds(deps)) registry.register(kind)
  return registry
}

/**
 * Keeps the residents whose kind `kindOf` knows. A resident of another kind stays in the setting
 * (a newer build may run it) but is not run here; `onUnknown` hears each unknown kind id once.
 */
export function unknownKindFilter(
  kindOf: (id: ResidentKindId) => ResidentKind, onUnknown: (c: ResidentConfig) => void,
): (c: ResidentConfig) => boolean {
  const reported = new Set<string>()
  return (c) => {
    try {
      kindOf(c.kind)
      return true
    } catch {
      if (!reported.has(c.kind)) {
        reported.add(c.kind)
        onUnknown(c)
      }
      return false
    }
  }
}

/** `kindOf` over kinds built with `deps`; the container passes the real ones. */
export function kindLookup(deps: KindDeps): (id: ResidentKindId) => ResidentKind {
  const registry = builtinRegistry(deps)
  return (id) => registry.get(id)
}

/** The kinds as the renderer fake and tests see them: their fields are real, nothing reaches the machine. */
const unwired = builtinRegistry(UNWIRED_KIND_DEPS)

export function kindOf(id: ResidentKindId): ResidentKind { return unwired.get(id) }

/** Every kind, as the renderer sees it. */
export function kindInfos(): ResidentKindInfo[] {
  return unwired.all().map((k) => ({
    id: k.id, defaultName: k.defaults.name, blurb: k.blurb, optionFields: k.optionFields.map((f) => ({ ...f })),
    digests: k.digests, appearance: k.appearance, cycleMinutes: k.cycle?.everyMinutes ?? null,
  }))
}

/** A new resident of `kind`: its defaults and the first id not in `taken` (`regent`, then `regent-2`, …). */
export function newResident(kind: ResidentKind, taken: ReadonlySet<string>): ResidentConfig {
  let id: string = kind.id
  for (let n = 2; taken.has(id); n++) id = `${kind.id}-${String(n)}`
  return { id, kind: kind.id, ...structuredClone(kind.defaults) }
}
