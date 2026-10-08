import type { BrainOptions, SceneKind } from '@shared/pets/brain'
import { isFiniteNumber, isRecord } from '@shared/guards'

/**
 * The renderer's one test seam: the few behaviours a test must change that no user setting
 * reaches (how fast the pets' scenes come round, drawing pets flat).
 *
 * Inert in a packaged build. A seam used to be a `globalThis.__apiary*` property read in
 * production code, so any script in the page could switch it. Now the values come from exactly
 * two places:
 *
 * - the window's own URL (`?seams=<json>`), which main puts there only when `APIARY_RENDERER_SEAMS`
 *   is set (`main/app/env.ts`, which reads nothing when the app is packaged), and
 * - `setTestSeams`, which only a component test imports.
 *
 * Anything else, including a property on `globalThis`, changes nothing. The `no-global-seams`
 * lint rule keeps it that way: this is the only module that may read an `__apiary*` name.
 */
export interface TestSeams {
  /** Makes scenes and remarks come round in seconds; see `BrainOptions`. */
  petBrainOptions?: BrainOptions | undefined
  /** Draw pets flat instead of rendering them in 3D (software WebGL is too slow for a test run). */
  petsFlat?: boolean | undefined
}

const SCENES: readonly string[] = ['catch', 'tennis', 'share', 'picnic', 'fish', 'tree', 'drive', 'parachute']

const isRange = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber)

function parseBrainOptions(v: unknown): BrainOptions | undefined {
  if (!isRecord(v)) return undefined
  const out: BrainOptions = {}
  if (isRange(v.sceneEveryMs)) out.sceneEveryMs = v.sceneEveryMs
  if (isRange(v.commentEveryMs)) out.commentEveryMs = v.commentEveryMs
  if (Array.isArray(v.sceneKinds)) out.sceneKinds = v.sceneKinds.filter((k): k is SceneKind => typeof k === 'string' && SCENES.includes(k))
  return out
}

/** The seams a window's URL carries (`?seams=<json>`); nothing for a missing or malformed value. */
export function parseTestSeams(search: string): TestSeams {
  try {
    const raw = new URLSearchParams(search).get('seams')
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    const out: TestSeams = {}
    const brain = parseBrainOptions(parsed.petBrainOptions)
    if (brain !== undefined) out.petBrainOptions = brain
    if (typeof parsed.petsFlat === 'boolean') out.petsFlat = parsed.petsFlat
    return out
  } catch {
    return {}
  }
}

let seams: TestSeams | null = null

/** The seams in force; empty in a packaged build. */
export function testSeams(): Readonly<TestSeams> {
  seams ??= parseTestSeams(window.location.search)
  return seams
}

/** Component tests only: sets these seams and leaves the others as they were (`undefined` clears one). */
export function setTestSeams(patch: TestSeams): void {
  seams = { ...testSeams(), ...patch }
}
