import { describe, expect, it } from 'vitest'
import { srcNeedingRedTest } from '../../.claude/hooks/testsFailOnBase.mjs'

/** `git log` as the hook asks for it: each commit is \x01<trailer>\x02 then its changed files. */
function logOf(commits: { trailer: string; files: string[] }[]): (args: string[]) => string {
  return () => commits.map((c) => `\x01${c.trailer}\x02\n\n${c.files.join('\n')}\n`).join('\n')
}

describe('which src files a branch must prove with a red-on-base test', () => {
  it('keeps a feature commit\'s files even when another commit on the branch carries a No-Red-Test-Reason', () => {
    const git = logOf([
      { trailer: 'comments only.', files: ['src/main/a.ts'] },
      { trailer: '', files: ['src/main/feature.ts', 'tests/unit/feature.test.ts'] },
    ])
    expect(srcNeedingRedTest(['src/main/a.ts', 'src/main/feature.ts'], 'base', git)).toEqual(['src/main/feature.ts'])
  })

  it('exempts the branch only when every changed src file came from commits with a reason', () => {
    const git = logOf([
      { trailer: 'layout only.', files: ['src/renderer/x.tsx'] },
      { trailer: 'comments only.', files: ['src/main/a.ts'] },
    ])
    expect(srcNeedingRedTest(['src/renderer/x.tsx', 'src/main/a.ts'], 'base', git)).toEqual([])
  })

  it('needs every changed src file proved when no commit gives a reason', () => {
    const git = logOf([{ trailer: '', files: ['src/main/a.ts'] }, { trailer: '', files: ['src/main/b.ts'] }])
    expect(srcNeedingRedTest(['src/main/a.ts', 'src/main/b.ts'], 'base', git)).toEqual(['src/main/a.ts', 'src/main/b.ts'])
  })
})
