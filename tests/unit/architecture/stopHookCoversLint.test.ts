import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')
const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
const hook = readFileSync(join(ROOT, '.claude/hooks/definition-of-done.mjs'), 'utf8')

/** The program each command runs: a `node <script>`'s script, else its first word (`eslint`, `depcruise`). */
function programs(command: string): string[] {
  return command.split('&&').map((part) => {
    const words = part.trim().split(/\s+/)
    return words[0] === 'node' ? words[1] : words[0]
  })
}

// The Stop hook is the definition of done an agent is held to; `npm run lint` is what CI runs. When a
// lint step was missing from the hook, agents finished "done" and CI (or the maintainer) found it:
// P3c's Docker shim passed the hook with two shellcheck warnings, and the hook never ran markdownlint
// or the doc-reference check at all.
describe('the Stop hook runs every step of npm run lint', () => {
  const steps = scripts.lint.split('&&').map((s) => /npm run (\S+)/.exec(s)?.[1]).filter((s): s is string => s !== undefined)

  it('reads the lint steps from package.json', () => {
    expect(steps.length).toBeGreaterThan(3)
  })

  it.each(steps)('%s', (step) => {
    for (const program of programs(scripts[step])) {
      expect(hook.includes(program), `.claude/hooks/definition-of-done.mjs never runs \`${program}\` (from \`npm run ${step}\`): run it on the changed files there, as the other lint steps are`).toBe(true)
    }
  })
})
