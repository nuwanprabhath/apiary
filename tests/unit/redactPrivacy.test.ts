import { describe, it, expect } from 'vitest'
import { redactString } from '@shared/redact'

describe('redaction of personal identifiers', () => {
  it('replaces an email address', () => {
    expect(redactString('sent to jane.doe+x@example.co.uk today')).toBe('sent to [email] today')
  })

  it('hides the user of a user@host: remote', () => {
    expect(redactString('nuwan@build-box:/srv/repo')).toBe('[user]@build-box:/srv/repo')
  })

  it('hides the user of an ssh:// remote', () => {
    expect(redactString('ssh://alice@example.org/repo.git')).toBe('ssh://[user]@example.org/repo.git')
  })

  it('keeps a plain git@ SSH remote as it is', () => {
    expect(redactString('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git')
    expect(redactString('ssh://git@gitlab.com/org/repo.git')).toBe('ssh://git@gitlab.com/org/repo.git')
  })

  it('rewrites /root, /var/home/<u> and C:\\Users\\<u> to ~', () => {
    expect(redactString('cwd=/root/project')).toBe('cwd=~/project')
    expect(redactString('in /var/home/bob/x')).toBe('in ~/x')
    expect(redactString('at C:\\Users\\carol\\work')).toBe('at ~\\work')
  })

  it('leaves look-alikes alone', () => {
    expect(redactString('/rooted/x and /srv/root2')).toBe('/rooted/x and /srv/root2')
    expect(redactString('@scope/pkg')).toBe('@scope/pkg')
  })

  it('truncates at a smaller limit when asked', () => {
    expect(redactString('a'.repeat(300), { max: 200 })).toBe(`${'a'.repeat(200)}…[+100 chars]`)
  })
})
