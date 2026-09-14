import { describe, it, expect } from 'vitest'
import { parseGitLabRemote, newMergeRequestUrl } from '../../src/main/plugins/gitlabRemote'

describe('parseGitLabRemote', () => {
  it('reads the scp-like form git uses for ssh remotes', () => {
    expect(parseGitLabRemote('git@gitlab.com:ternandsparrow/paratoo-fdcp.git')).toEqual({
      host: 'https://gitlab.com',
      project: 'ternandsparrow/paratoo-fdcp',
      webUrl: 'https://gitlab.com/ternandsparrow/paratoo-fdcp',
    })
  })

  it('reads https remotes, with or without the .git suffix', () => {
    const withSuffix = parseGitLabRemote('https://gitlab.com/group/project.git')
    const without = parseGitLabRemote('https://gitlab.com/group/project')
    expect(withSuffix).toEqual(without)
    expect(withSuffix?.webUrl).toBe('https://gitlab.com/group/project')
  })

  it('reads the ssh:// form, and drops the port — it belongs to git, not to the web UI', () => {
    expect(parseGitLabRemote('ssh://git@gitlab.example.com:2222/group/project.git')).toEqual({
      host: 'https://gitlab.example.com',
      project: 'group/project',
      webUrl: 'https://gitlab.example.com/group/project',
    })
  })

  it('keeps subgroups, which are just path segments', () => {
    expect(parseGitLabRemote('git@gitlab.com:group/sub/deeper/project.git')?.project)
      .toBe('group/sub/deeper/project')
  })

  it('works with a self-hosted host', () => {
    expect(parseGitLabRemote('git@gitlab.internal.example:team/tool.git')?.webUrl)
      .toBe('https://gitlab.internal.example/team/tool')
  })

  it('returns null for GitHub, rather than a GitLab URL that would 404', () => {
    expect(parseGitLabRemote('git@github.com:someone/project.git')).toBeNull()
    expect(parseGitLabRemote('https://github.com/someone/project.git')).toBeNull()
  })

  it('returns null for things that are not remotes', () => {
    expect(parseGitLabRemote('')).toBeNull()
    expect(parseGitLabRemote('   ')).toBeNull()
    expect(parseGitLabRemote('not a url at all')).toBeNull()
    // A host with no project path is not something a merge request could be created against.
    expect(parseGitLabRemote('https://gitlab.com/')).toBeNull()
    expect(parseGitLabRemote('https://gitlab.com/justagroup')).toBeNull()
  })

  it('returns null for a local path remote', () => {
    expect(parseGitLabRemote('/srv/git/project.git')).toBeNull()
  })
})

describe('newMergeRequestUrl', () => {
  const remote = {
    host: 'https://gitlab.com',
    project: 'group/project',
    webUrl: 'https://gitlab.com/group/project',
  }

  it('opens GitLab\'s own form with the source branch chosen', () => {
    expect(newMergeRequestUrl(remote, 'feature/thing')).toBe(
      'https://gitlab.com/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fthing',
    )
  })

  it('escapes a branch name that would otherwise break the query', () => {
    // Branch names legitimately contain slashes, and can contain `&` and `#`, which would end the
    // parameter early and silently open the form with no branch selected.
    const url = newMergeRequestUrl(remote, 'fix/a&b#c')
    expect(url).toContain('fix%2Fa%26b%23c')
    expect(new URL(url).searchParams.get('merge_request[source_branch]')).toBe('fix/a&b#c')
  })
})
