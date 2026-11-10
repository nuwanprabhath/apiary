import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RESIDENT_FIELD_DEFAULTS } from '@shared/settings/residents'
import { MANIFEST_LIMITS, validateResidentKindManifest, type ResidentKindManifest } from '@shared/residentKindManifest'
import type { ResidentCapability, ResidentKind } from '../kindTypes'

/** What every data kind's system prompt starts with, before the author's text. */
function preamble(name: string): string {
  return [
    `You are ${name}, a resident agent living inside Apiary, defined by the user's own kind folder.`,
    'Use the Apiary tools you were given for their Claude Code sessions. Ask before anything that changes the machine or the outside world.',
  ].join('\n')
}

/**
 * The kind a validated manifest describes. It has no code of its own: no setup check, no binaries,
 * no environment, no `prepare`; it never drives the digest; a new one asks before every tool
 * (`manual`).
 */
export function manifestKind(m: ResidentKindManifest, promptText: string): ResidentKind {
  const ownPrompt = [m.prompt, promptText].filter((t) => t !== '').join('\n\n').slice(0, MANIFEST_LIMITS.prompt)
  const kind: ResidentKind = {
    id: m.id,
    defaults: {
      name: m.name,
      enabled: false,
      model: 'sonnet',
      digestModel: 'haiku',
      schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
      pauseAboveUsagePercent: 70,
      ...RESIDENT_FIELD_DEFAULTS,
      permissionMode: 'manual',
    },
    blurb: m.blurb,
    appearance: m.appearance,
    capabilities: m.capabilities satisfies readonly ResidentCapability[],
    digests: false,
    optionFields: m.optionFields.map((f) => ({ ...f, input: 'text' as const })),
    quickActions: m.quickActions.map((a) => ({ id: a.id, label: a.label, doing: a.doing, run: { kind: 'prompt' as const, text: a.text } })),
    bins: {},
    instantMatches: false,
    setup: () => null,
    systemPrompt: (name) => (ownPrompt === '' ? preamble(name) : `${preamble(name)}\n\n${ownPrompt}`),
  }
  if (m.cycle !== undefined) kind.cycle = { ...m.cycle }
  if (m.toolPolicy !== undefined) kind.toolPolicy = { disallowedTools: [...m.toolPolicy.disallowedTools] }
  return kind
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * The data kinds in `dir`, one folder each, read once. A folder whose `kind.json` is missing, not
 * JSON, invalid, or names an id other than the folder's is reported to `onInvalid` and skipped. A
 * missing `dir` is no kinds.
 */
export function readManifestKinds(
  dir: string, reserved: ReadonlySet<string>, onInvalid: (folder: string, reason: string) => void,
): ResidentKind[] {
  let folders: string[]
  try {
    folders = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch {
    return []
  }
  const kinds: ResidentKind[] = []
  for (const folder of folders) {
    const json = readText(join(dir, folder, 'kind.json'))
    if (json === null) { onInvalid(folder, 'no kind.json'); continue }
    let raw: unknown
    try {
      raw = JSON.parse(json)
    } catch {
      onInvalid(folder, 'kind.json is not valid JSON')
      continue
    }
    const result = validateResidentKindManifest(raw, reserved)
    if (!result.ok) { onInvalid(folder, result.reasons.join('; ')); continue }
    if (result.manifest.id !== folder) { onInvalid(folder, `id ${result.manifest.id} is not the folder's name`); continue }
    kinds.push(manifestKind(result.manifest, readText(join(dir, folder, 'PROMPT.md')) ?? ''))
  }
  return kinds
}
