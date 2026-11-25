import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PRIVACY_FEATURES, type PrivacyFeature } from '@shared/domain/privacy'
import { judge, loadAllow, read, staleReport, walk } from './allowlist'

/**
 * Automatic processing that sends data off the machine (a digest window, a resident's scheduled
 * cycle, the Slack poll, a `glab` lookup, Linux's dictionary download) starts only after
 * `PrivacyGate.allows(feature)`. Each site names the call that starts the processing (`start`) and
 * the check that must stand before it in the same function (`gate`).
 */
interface Site {
  id: string
  file: string
  feature: PrivacyFeature
  start: string
  gate: string
}

const SITES: Site[] = [
  { id: 'digest window', file: 'src/main/knowledge/digester.ts', feature: 'backgroundDigest', start: 'this.digestWindow(', gate: 'this.mayProceed()' },
  { id: 'digest pause loop', file: 'src/main/knowledge/digester.ts', feature: 'backgroundDigest', start: 'await this.wait(PAUSE_RECHECK_MS)', gate: 'this.gateOpen()' },
  { id: 'digest resume', file: 'src/main/residents/residentDigest.ts', feature: 'backgroundDigest', start: 'this.job.resume(', gate: '!this.allowed()' },
  { id: 'resident cycle', file: 'src/main/residents/residentService.ts', feature: 'residentCycles', start: 'this.sendTurn(r.config.id, cycle.prompt', gate: "this.allows('residentCycles')" },
  { id: 'slack poll', file: 'src/main/slack/slackBridge.ts', feature: 'slackBridge', start: 'this.timer = setTimeout(', gate: 'this.allowed()' },
  { id: 'glab lookup', file: 'src/main/plugins/gitlabMr.ts', feature: 'gitlabLookups', start: 'await exec(', gate: 'lookupsAllowed(options.allowed)' },
  { id: 'linux dictionaries', file: 'src/main/spelling/spellingService.ts', feature: 'spellDictionaries', start: 'setSpellCheckerLanguages([resolved])', gate: 'this.held()' },
]

function isFunction(n: ts.Node): boolean {
  return ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)
}

/** What is wrong with a site, or null. The gate must stand in the function that holds the start, before it. */
function problem(site: Site, text: string): string | null {
  const at = text.indexOf(site.start)
  if (at < 0) return `${site.id}: ${site.file} no longer contains \`${site.start}\`; update SITES`
  const source = ts.createSourceFile(site.file, text, ts.ScriptTarget.Latest, true)
  let inner: ts.Node = source
  const visit = (n: ts.Node): void => {
    if (at >= n.getStart() && at < n.getEnd()) {
      if (isFunction(n)) inner = n
      ts.forEachChild(n, visit)
    }
  }
  visit(source)
  const before = text.slice(inner.getStart(), at)
  return before.includes(site.gate) ? null : `${site.id}: \`${site.start}\` in ${site.file} runs without \`${site.gate}\` before it in the same function`
}

describe('automatic processing that leaves the machine is behind the privacy gate', () => {
  const allow = loadAllow('privacyGated.allow.json')

  it('every start site is preceded by its gate check', () => {
    const found = SITES.map((s) => problem(s, read(s.file))).filter((p): p is string => p !== null)
    const verdict = judge(found, allow)
    expect([...verdict.unlisted, ...staleReport('privacyGated.allow.json', verdict.stale)]).toEqual([])
  })

  it('every privacy feature has a start site, so a new one cannot ship ungated', () => {
    const covered = new Set(SITES.map((s) => s.feature))
    expect(PRIVACY_FEATURES.filter((f) => !covered.has(f))).toEqual([])
  })

  it('every privacy feature is asked of the gate somewhere in main', () => {
    const main = walk(['src/main'], ['.ts']).map(read).join('\n')
    expect(PRIVACY_FEATURES.filter((f) => !main.includes(`allows('${f}')`))).toEqual([])
  })

  it('notices a gate check that was removed', () => {
    const site = SITES.find((s) => s.id === 'slack poll')
    if (site === undefined) throw new Error('site missing')
    const original = read(site.file)
    const edited = original.replace('if (!this.allowed()) return\n    this.timer = setTimeout(', 'this.timer = setTimeout(')
    expect(edited).not.toBe(original)
    expect(problem(site, edited)).toContain('runs without')
  })
})
