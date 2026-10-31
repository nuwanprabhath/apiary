import { describe, expect, it } from 'vitest'
import { parseGitlabProject } from '../../../src/main/residents/kinds/mrDeskProject'

describe('parseGitlabProject', () => {
  it('reads the maintainer\'s URL as its path on gitlab.com', () => {
    expect(parseGitlabProject('https://gitlab.com/ternandsparrow/paratoo-fdcp')).toEqual({ project: 'ternandsparrow/paratoo-fdcp', host: 'gitlab.com' })
  })

  it('reads a self-hosted URL with subgroups, .git, a trailing slash or a /-/ page', () => {
    const want = { project: 'group/sub/project', host: 'gitlab.example.com' }
    expect(parseGitlabProject('https://gitlab.example.com/group/sub/project')).toEqual(want)
    expect(parseGitlabProject('https://gitlab.example.com/group/sub/project.git')).toEqual(want)
    expect(parseGitlabProject('https://gitlab.example.com/group/sub/project/')).toEqual(want)
    expect(parseGitlabProject('https://gitlab.example.com/group/sub/project/-/merge_requests/1175')).toEqual(want)
    expect(parseGitlabProject('http://gitlab.example.com:8080/group/project')).toEqual({ project: 'group/project', host: 'gitlab.example.com:8080' })
  })

  it('passes a plain path through, trimmed', () => {
    expect(parseGitlabProject('group/project')).toEqual({ project: 'group/project', host: null })
    expect(parseGitlabProject('  group/sub/project ')).toEqual({ project: 'group/sub/project', host: null })
  })

  it('is null for what is neither', () => {
    for (const bad of ['', 'project', 'https://gitlab.com/', 'https://gitlab.com/solo', 'ssh://git@gitlab.com/a/b', 'a b/c']) {
      expect(parseGitlabProject(bad)).toBeNull()
    }
  })
})
