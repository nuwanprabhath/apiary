import { describe, it, expect } from 'vitest'
import { extractRefs, refsInQuery } from '../../../src/main/knowledge/refs'

const values = (text: string, kind: string): string[] =>
  extractRefs(text).filter((r) => r.kind === kind).map((r) => r.value)

describe('extractRefs', () => {
  it('reads !123 as a merge request', () => {
    expect(extractRefs('see !123 please')).toEqual([{ kind: 'mr', value: '123' }])
  })

  it('reads #123 as an issue, but not a colour, a heading or a fragment', () => {
    expect(values('fixes #45', 'issue')).toEqual(['45'])
    expect(values('color: #123456; background: #fff', 'issue')).toEqual([])
    expect(values('## Heading\n# Title', 'issue')).toEqual([])
    expect(values('docs at https://example.com/page#123', 'issue')).toEqual([])
  })

  it('reads ticket keys and skips encodings and hashes', () => {
    expect(values('ABC-123 and PROJ2-9', 'ticket')).toEqual(['ABC-123', 'PROJ2-9'])
    expect(values('UTF-8 SHA-256 ISO-8601 CVE-2024', 'ticket')).toEqual([])
  })

  it('reads a GitLab MR URL as the project ref and the bare number', () => {
    expect(values('https://gitlab.example.com/grp/sub/proj/-/merge_requests/1175/diffs', 'mr'))
      .toEqual(['grp/sub/proj!1175', '1175'])
  })

  it('reads a GitHub PR URL as the repo ref and the bare number', () => {
    expect(values('https://github.com/acme/app/pull/77', 'mr')).toEqual(['acme/app#77', '77'])
  })

  it('reads a Jira URL as a ticket', () => {
    expect(extractRefs('https://jira.example.com/browse/ABC-123?x=1')).toEqual([{ kind: 'ticket', value: 'ABC-123' }])
  })

  it('normalises any other URL to host and path', () => {
    expect(extractRefs('see (HTTPS://Example.COM/Docs/Page/?q=1#frag).'))
      .toEqual([{ kind: 'url', value: 'example.com/Docs/Page' }])
  })

  it('deduplicates', () => {
    expect(extractRefs('!5 and !5 and ABC-1 ABC-1')).toEqual([
      { kind: 'mr', value: '5' }, { kind: 'ticket', value: 'ABC-1' },
    ])
  })

  it('refsInQuery applies the same rules to a question', () => {
    expect(refsInQuery('find https://gitlab.example.com/g/p/-/merge_requests/9')).toContainEqual({ kind: 'mr', value: '9' })
  })
})
