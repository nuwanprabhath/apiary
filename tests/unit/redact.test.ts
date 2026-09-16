import { describe, it, expect } from 'vitest'
import { redact, redactString } from '../../src/shared/redact'

const home = '/Users/nuwan'

describe('redacting paths', () => {
  it('replaces the running user\'s home with a tilde, keeping the shape of the path', () => {
    // The shape is the whole diagnostic value — which worktree, how deep — and the account name
    // is none of it.
    expect(redactString('/Users/nuwan/projects/paratoo-fdcp.worktrees/dev-1.0.12', { home }))
      .toBe('~/projects/paratoo-fdcp.worktrees/dev-1.0.12')
  })

  it('replaces somebody else\'s home directory too', () => {
    // A cwd recorded in a session's JSONL on another machine is still a person's name.
    expect(redactString('/home/someone/projects/x')).toBe('~/projects/x')
  })

  it('redacts a home directory that appears mid-sentence', () => {
    expect(redactString("fatal: already used by worktree at '/home/nuwan/p.worktrees/dev'"))
      .toBe("fatal: already used by worktree at '~/p.worktrees/dev'")
  })

  it('leaves a path that names nobody alone', () => {
    expect(redactString('/opt/homebrew/bin/claude')).toBe('/opt/homebrew/bin/claude')
  })
})

describe('redacting credentials', () => {
  it.each([
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345', '[redacted-api-key]'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', '[redacted-github-token]'],
    ['glpat-abcdefghijklmnopqrst', '[redacted-gitlab-token]'],
  ])('removes %s', (secret, expected) => {
    expect(redactString(`using ${secret} now`)).toBe(`using ${expected} now`)
  })

  it('removes a bearer header but keeps the word, so the shape is still readable', () => {
    expect(redactString('Authorization: Bearer abcdefghijklmnop'))
      .toBe('Authorization: Bearer [redacted]')
  })

  it('removes a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r'
    expect(redactString(`cookie=${jwt}`)).toBe('cookie=[redacted-jwt]')
  })

  it('removes a token passed as a parameter, whatever it is called', () => {
    expect(redactString('https://example.invalid/x?token=abcd1234&page=2'))
      .toBe('https://example.invalid/x?token=[redacted]&page=2')
    expect(redactString('password: hunter2000')).toBe('password=[redacted]')
  })

  it('does not redact ordinary words that merely look technical', () => {
    // A rule that eats too much makes the log useless, and a log nobody can read gets turned off.
    expect(redactString('checked out dev/1.0.12 in repo-c-wt'))
      .toBe('checked out dev/1.0.12 in repo-c-wt')
  })
})

describe('redacting structured fields', () => {
  it('walks objects and arrays', () => {
    expect(redact({ cwd: '/Users/nuwan/x', refs: ['/home/bo/y'] }, { home }))
      .toEqual({ cwd: '~/x', refs: ['~/y'] })
  })

  it('keeps numbers, booleans and null as they are', () => {
    expect(redact({ ms: 12, ok: false, err: null })).toEqual({ ms: 12, ok: false, err: null })
  })

  it('reduces an Error to its name and message', () => {
    expect(redact(new Error('failed at /Users/nuwan/x'), { home }))
      .toEqual({ name: 'Error', message: 'failed at ~/x' })
  })

  it('truncates a field that grew without bound', () => {
    // This is the guard against transcript text reaching a log through some field nobody meant
    // to be large.
    const long = 'a'.repeat(5000)
    const out = redactString(long)
    expect(out.length).toBeLessThan(600)
    expect(out).toContain('[+4488 chars]')
  })

  it('cuts cycles rather than throwing, because a logger must never crash the app', () => {
    const cyclic: Record<string, unknown> = { name: 'x' }
    cyclic.self = cyclic
    expect(redact(cyclic)).toEqual({ name: 'x', self: '[circular]' })
  })

  it('describes anything it cannot safely serialise instead of serialising it', () => {
    expect(redact({ fn: () => 1 })).toEqual({ fn: '[function]' })
  })

  it('caps a long array', () => {
    expect((redact(Array.from({ length: 60 }, (_, i) => i)) as unknown[]).at(-1))
      .toBe('[+10 more]')
  })
})
