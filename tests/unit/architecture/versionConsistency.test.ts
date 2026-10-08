import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Prevents: a version bump that reaches one file and not the others. Every change bumps the
 * version (root CLAUDE.md, "Versioning, changelog, commits"), and the bump lives in four places:
 * `package.json`, `package-lock.json` twice (its top-level `version` and the root package entry),
 * and the newest `## [x.y.z]` heading in CHANGELOG.md. The docs named only the first and the last,
 * so an agent could bump by hand and leave the lockfile on the old version (the 1.34.0 feature agent
 * noticed it only by chance). `npm version <x.y.z> --no-git-tag-version` updates both JSON files;
 * the changelog section is written by hand.
 */
const ROOT = join(__dirname, '../../..')
const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as Record<string, unknown>

describe('the version is the same everywhere it is written', () => {
  const pkg = json('package.json').version
  const lock = json('package-lock.json')
  const lockRoot = (lock.packages as Record<string, { version?: unknown }> | undefined)?.['']?.version
  const changelog = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'))?.[1]

  it('package-lock.json matches package.json (run `npm version <x.y.z> --no-git-tag-version`)', () => {
    expect({ lockVersion: lock.version, lockRootPackage: lockRoot }).toEqual({ lockVersion: pkg, lockRootPackage: pkg })
  })

  it('the newest CHANGELOG.md section is for that version (add a new `## [x.y.z] - date` section; never reuse one)', () => {
    expect(changelog).toBe(pkg)
  })
})
